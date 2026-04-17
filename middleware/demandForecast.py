import math
import os
import sys
import warnings

import mysql.connector
import pandas as pd
from prophet import Prophet
from sqlalchemy import create_engine, text

warnings.filterwarnings("ignore")

# Get pharmacy_id from command line argument
pharmacy_id = sys.argv[1] if len(sys.argv) > 1 else 1

# MySQL config — reads from environment variables (Railway sets these automatically)
user     = os.environ.get("DB_USER", "root")
password = os.environ.get("DB_PASSWORD", "NewStrongPassword123!")
host     = os.environ.get("DB_HOST", "localhost")
port     = os.environ.get("DB_PORT", "3306")
database = os.environ.get("DB_NAME", "major")

# Create database connection (include port for Aiven Cloud which uses non-standard port)
try:
    engine = create_engine(f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}?ssl_ca=&ssl_verify_cert=false")
except Exception as e:
    try:
        engine = create_engine(f"mysql+mysqlconnector://{user}:{password}@{host}:{port}/{database}")
    except Exception as e2:
        exit(1)

# Load sales data
query_sales = f"""
SELECT pharmacy_id, medicine_id, quantity_sold, transaction_date
FROM pharmacy_sales_history
WHERE pharmacy_id = {pharmacy_id};
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
query_stock = f"""
SELECT medicine_id, SUM(quantity) AS current_stock
FROM stock
WHERE pharmacy_id = {pharmacy_id} AND expiry_date > CURDATE()
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

if not df.empty and len(df['medicine_id'].unique()) > 0:
    for med in df['medicine_id'].unique():
        med_df = df[df['medicine_id'] == med][['ds', 'y']]

        if len(med_df) < 10:
            continue

        try:
            model = Prophet()
            model.fit(med_df)

            future = model.make_future_dataframe(periods=30)
            forecast = model.predict(future)

            forecast_sum = forecast.tail(30)['yhat'].sum()

            stock_val = stock_df.query(f"medicine_id == {med}")['current_stock'].values if not stock_df.empty else []
            current_stock = stock_val[0] if len(stock_val) > 0 else 0

            needed = max(0, forecast_sum - current_stock)
            needed_rounded = math.ceil(needed) if needed > 0 else 0

            future_predictions.append({
                'medicine_id': med,
                'forecast_next_30_days': math.ceil(forecast_sum),
                'current_stock': current_stock,
                'stock_to_order': needed_rounded
            })
            
        except Exception as e:
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
        print("-" * 50)
    
    # Summary
    total_to_order = result['stock_to_order'].sum()
    medicines_need_restock = len(result[result['stock_to_order'] > 0])
    print(f"\nSUMMARY:")
    print(f"Total medicines analyzed: {len(result)}")
    print(f"Medicines needing restock: {medicines_need_restock}")
    print(f"Total units to order: {total_to_order}")
else:
    print("No forecast data available")