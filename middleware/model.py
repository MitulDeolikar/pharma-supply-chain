import math
import warnings

import mysql.connector
import pandas as pd
from prophet import Prophet
from sqlalchemy import create_engine, text

warnings.filterwarnings("ignore")

# MySQL config
user = "root"
password = "NewStrongPassword123!"
host = "localhost"
database = "major"

# Create database connection
try:
    engine = create_engine(f"mysql+pymysql://{user}:{password}@{host}/{database}")
except Exception as e:
    try:
        engine = create_engine(f"mysql+mysqlconnector://{user}:{password}@{host}/{database}")
    except Exception as e2:
        exit(1)

# Load sales data
query_sales = """
SELECT pharmacy_id, medicine_id, quantity_sold, transaction_date
FROM pharmacy_sales_history
WHERE pharmacy_id = 1;
"""

try:
    df = pd.read_sql(query_sales, engine)
    if df.empty:
        df = pd.DataFrame()
except Exception as e:
    df = pd.DataFrame()

# Process sales data
if not df.empty:
    df['transaction_date'] = pd.to_datetime(df['transaction_date'])
    df = df.groupby(['medicine_id', 'transaction_date'])['quantity_sold'].sum().reset_index()
    df.rename(columns={'transaction_date': 'ds', 'quantity_sold': 'y'}, inplace=True)

# Load current stock (only non-expired)
query_stock = """
SELECT medicine_id, SUM(quantity) AS current_stock
FROM stock
WHERE pharmacy_id = 1 AND expiry_date > CURDATE()
GROUP BY medicine_id;
"""

try:
    stock_df = pd.read_sql(query_stock, engine)
    if stock_df.empty:
        stock_df = pd.DataFrame()
except Exception as e:
    stock_df = pd.DataFrame()

# Forecasting
future_predictions = []
total_medicines_analyzed = 0
skipped_medicines = []

if not df.empty and len(df['medicine_id'].unique()) > 0:
    print(f"Starting analysis for {len(df['medicine_id'].unique())} medicines...")
    
    for med in df['medicine_id'].unique():
        med_df = df[df['medicine_id'] == med][['ds', 'y']]
        total_medicines_analyzed += 1
        
        print(f"Medicine {med}: {len(med_df)} sales records")

        if len(med_df) < 10:
            skipped_medicines.append((med, f"Only {len(med_df)} records (need min 10)"))
            print(f"  Skipping: insufficient data ({len(med_df)} records)")
            continue

        try:
            # Create and train Prophet model with better parameters
            model = Prophet(
                daily_seasonality=True,
                weekly_seasonality=True,
                yearly_seasonality=False,  # Not enough data for yearly
                changepoint_prior_scale=0.05  # More conservative for small datasets
            )
            model.fit(med_df)

            # Make 30-day forecast
            future = model.make_future_dataframe(periods=30)
            forecast = model.predict(future)

            # Get forecast for next 30 days only
            forecast_sum = forecast.tail(30)['yhat'].sum()
            
            # Ensure no negative predictions
            forecast_sum = max(0, forecast_sum)

            # Get current stock
            stock_val = stock_df.query(f"medicine_id == {med}")['current_stock'].values if not stock_df.empty else []
            current_stock = stock_val[0] if len(stock_val) > 0 else 0

            # Calculate stock needed (round up to next whole number)
            needed = max(0, forecast_sum - current_stock)
            needed_rounded = math.ceil(needed) if needed > 0 else 0

            future_predictions.append({
                'medicine_id': med,
                'forecast_next_30_days': round(forecast_sum, 2),
                'current_stock': current_stock,
                'stock_to_order': needed_rounded,
                'training_data_points': len(med_df)
            })
            
            print(f"  ✓ Forecast: {round(forecast_sum, 2)} units, Current: {current_stock}, Need: {needed_rounded} (rounded up from {round(needed, 2)})")
            
        except Exception as e:
            skipped_medicines.append((med, f"Training error: {str(e)}"))
            print(f"  ✗ Error training model: {str(e)}")
            continue

result = pd.DataFrame(future_predictions)

# Display final results
if not result.empty:
    print("\nDemand Forecast Results:")
    print("=" * 70)
    for _, row in result.iterrows():
        print(f"Medicine {int(row['medicine_id'])}: ")
        print(f"  Predicted 30-day demand: {row['forecast_next_30_days']} units")
        print(f"  Current stock: {row['current_stock']} units")
        print(f"  Need to order: {row['stock_to_order']} units")
        print(f"  Training data: {row.get('training_data_points', 'N/A')} sales records")
        print("-" * 50)
    
    # Summary
    total_to_order = result['stock_to_order'].sum()
    medicines_need_restock = len(result[result['stock_to_order'] > 0])
    print(f"\nSUMMARY:")
    print(f"Total medicines analyzed: {len(result)}")
    print(f"Medicines needing restock: {medicines_need_restock}")
    print(f"Total units to order: {total_to_order}")
    
    if skipped_medicines:
        print(f"\nSkipped medicines:")
        for med_id, reason in skipped_medicines:
            print(f"  Medicine {med_id}: {reason}")
else:
    print("No forecast data available")
    if skipped_medicines:
        print("Reasons:")
        for med_id, reason in skipped_medicines:
            print(f"  Medicine {med_id}: {reason}")
