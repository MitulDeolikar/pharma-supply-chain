import requests
import urllib.parse

# 🔑 Your Geoapify API key
API_KEY = "1e257e1327bd47c3b50b8550710fc775"

# 🚗 Enter two locations
start_address = "Mangalore, Karnataka"
end_address = "Udupi, Karnataka"

# 🔍 Function to get latitude & longitude using Geoapify Geocoding API
def get_coordinates(address):
    encoded_address = urllib.parse.quote(address)
    url = f"https://api.geoapify.com/v1/geocode/search?text={encoded_address}&apiKey={API_KEY}"

    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        if data.get("features"):
            props = data["features"][0]["properties"]
            return props["lat"], props["lon"], props.get("formatted", address)
        else:
            print(f"❌ No coordinates found for: {address}")
            return None
    except Exception as e:
        print(f"⚠️ Error fetching coordinates for {address}: {e}")
        return None

# 📍 Get coordinates for both locations
start = get_coordinates(start_address)
end = get_coordinates(end_address)

if start and end:
    start_lat, start_lon, start_fmt = start
    end_lat, end_lon, end_fmt = end

    print(f"\n🗺️ Route from:\n  {start_fmt}\n➡️ To:\n  {end_fmt}\n")

    # 🚦 Routing API call
    routing_url = (
        f"https://api.geoapify.com/v1/routing?"
        f"waypoints={start_lat},{start_lon}|{end_lat},{end_lon}"
        f"&mode=drive&apiKey={API_KEY}"
    )

    try:
        route_response = requests.get(routing_url, timeout=10)
        route_response.raise_for_status()
        route_data = route_response.json()

        if route_data.get("features"):
            props = route_data["features"][0]["properties"]
            distance_km = props["distance"] / 1000  # meters → km
            time_min = props["time"] / 60  # seconds → minutes
            mode = props["mode"]

            print(f"🚘 Mode: {mode}")
            print(f"📏 Distance: {distance_km:.2f} km")
            print(f"⏱️ Estimated Time: {time_min:.2f} minutes")

        else:
            print("❌ No route found between the locations.")

    except Exception as e:
        print("⚠️ Error fetching route:", e)

else:
    print("❌ Could not get coordinates for one or both locations.")
