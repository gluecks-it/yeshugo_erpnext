# Copyright (c) 2026, Gluecks IT and contributors
# For license information, please see license.txt

import frappe
import requests
import json
import math
from datetime import datetime
from frappe.utils import now_datetime, get_datetime
from dateutil import parser as dateutil_parser


# =============================================================================
# YesHugo API Client
# =============================================================================

class YesHugoAPIClient:
	"""
	Client for YesHugo Fleet Management API

	API uses Hydra/JSON-LD format with:
	- hydra:member for result lists
	- hydra:totalItems for total count
	- Distances in METERS (convert to km for storage)
	- Odometer in METERS (convert to km for storage)
	"""

	BASE_URL = "https://api.yeshugo.com"

	def __init__(self):
		self.settings = frappe.get_single("YesHugo Settings")

	def _get_x_token(self):
		"""Get decrypted persistent X-Token"""
		if not self.settings.get("x_token"):
			return None
		return self.settings.get_password("x_token")

	def _get_jwt_token(self):
		"""Get decrypted JWT token"""
		if not self.settings.get("api_key"):
			return None
		return self.settings.get_password("api_key")

	def _get_headers(self):
		"""
		Get authorization headers.

		X-Token is persistent and always valid.
		JWT Token expires after minutes.
		"""
		headers = {
			"Content-Type": "application/json",
			"Accept": "application/json"
		}

		x_token = self._get_x_token()
		if x_token:
			headers["X-Token"] = x_token

		jwt_token = self._get_jwt_token()
		if jwt_token:
			headers["Authorization"] = jwt_token

		return headers

	def has_persistent_token(self):
		"""Check if persistent X-Token is configured"""
		return bool(self._get_x_token())

	def has_any_token(self):
		"""Check if any token (X-Token or JWT) is configured"""
		return bool(self._get_x_token() or self._get_jwt_token())

	def _extract_list(self, response_data):
		"""
		Extract list from API response.
		Handles Hydra format (hydra:member) and plain arrays.
		"""
		if response_data is None:
			return []
		if isinstance(response_data, list):
			return response_data
		# Hydra format
		if "hydra:member" in response_data:
			return response_data["hydra:member"]
		# Alternative formats
		return response_data.get("data", response_data.get("results", []))

	def _extract_total(self, response_data):
		"""Extract total count from API response."""
		if response_data is None:
			return 0
		if isinstance(response_data, list):
			return len(response_data)
		# Hydra format
		if "hydra:totalItems" in response_data:
			return response_data["hydra:totalItems"]
		return response_data.get("total", response_data.get("count", 0))

	def get_vehicles(self, page=1, items_per_page=100):
		"""
		Get list of vehicles.
		GET /vehicles
		"""
		url = f"{self.BASE_URL}/vehicles"
		params = {"page": page, "itemsPerPage": items_per_page}

		try:
			response = requests.get(url, headers=self._get_headers(), params=params, timeout=30)
			response.raise_for_status()
			return response.json()
		except requests.exceptions.RequestException as e:
			frappe.log_error(f"Failed to get vehicles: {str(e)}", "YesHugo API")
			return None

	def get_vehicle(self, vehicle_id):
		"""
		Get single vehicle details.
		GET /vehicles/{id}
		"""
		url = f"{self.BASE_URL}/vehicles/{vehicle_id}"

		try:
			response = requests.get(url, headers=self._get_headers(), timeout=30)
			response.raise_for_status()
			return response.json()
		except requests.exceptions.RequestException as e:
			frappe.log_error(f"Failed to get vehicle {vehicle_id}: {str(e)}", "YesHugo API")
			return None

	def get_trips(self, page=1, items_per_page=100, vehicle_id=None, start_time_after=None, start_time_before=None, receiving_data=None, order_start_time=None):
		"""
		Get list of trips.
		GET /trips

		Filters:
		- vehicle: IRI reference to vehicle
		- startTime[after]: ISO datetime string
		- startTime[before]: ISO datetime string
		- receivingData: boolean
		- order[startTime]: "asc" or "desc"
		"""
		url = f"{self.BASE_URL}/trips"
		params = {"page": page, "itemsPerPage": items_per_page}

		if vehicle_id:
			# YesHugo expects vehicle as IRI reference
			params["vehicle"] = f"/vehicles/{vehicle_id}"
		if start_time_after:
			params["startTime[after]"] = start_time_after
		if start_time_before:
			params["startTime[before]"] = start_time_before
		if receiving_data is not None:
			params["receivingData"] = "true" if receiving_data else "false"
		if order_start_time:
			params["order[startTime]"] = order_start_time

		try:
			response = requests.get(url, headers=self._get_headers(), params=params, timeout=30)
			response.raise_for_status()
			return response.json()
		except requests.exceptions.RequestException as e:
			frappe.log_error(f"Failed to get trips: {str(e)}", "YesHugo API")
			return None

	def get_trip(self, trip_id):
		"""
		Get single trip details.
		GET /trips/{id}
		"""
		url = f"{self.BASE_URL}/trips/{trip_id}"

		try:
			response = requests.get(url, headers=self._get_headers(), timeout=30)
			response.raise_for_status()
			return response.json()
		except requests.exceptions.RequestException as e:
			frappe.log_error(f"Failed to get trip {trip_id}: {str(e)}", "YesHugo API")
			return None

	def get_trip_segments(self, trip_id=None, page=1, items_per_page=100):
		"""
		Get trip segments.
		GET /trip_segments
		"""
		url = f"{self.BASE_URL}/trip_segments"
		params = {"page": page, "itemsPerPage": items_per_page}

		if trip_id:
			params["trip"] = f"/trips/{trip_id}"

		try:
			response = requests.get(url, headers=self._get_headers(), params=params, timeout=30)
			response.raise_for_status()
			return response.json()
		except requests.exceptions.RequestException as e:
			frappe.log_error(f"Failed to get trip segments: {str(e)}", "YesHugo API")
			return None

	def get_charge_events(self, vehicle_id=None, page=1, items_per_page=100):
		"""
		Get charging events.
		GET /charge_events
		"""
		url = f"{self.BASE_URL}/charge_events"
		params = {"page": page, "itemsPerPage": items_per_page}

		if vehicle_id:
			params["vehicle"] = f"/vehicles/{vehicle_id}"

		try:
			response = requests.get(url, headers=self._get_headers(), params=params, timeout=30)
			response.raise_for_status()
			return response.json()
		except requests.exceptions.RequestException as e:
			frappe.log_error(f"Failed to get charge events: {str(e)}", "YesHugo API")
			return None

	def get_charge_sessions(self, vehicle_id=None, page=1, items_per_page=100, order_plugged_in_at=None):
		"""
		Get charging sessions.
		GET /charge_sessions
		"""
		url = f"{self.BASE_URL}/charge_sessions"
		params = {"page": page, "itemsPerPage": items_per_page}

		if vehicle_id:
			params["vehicle"] = f"/vehicles/{vehicle_id}"
		if order_plugged_in_at:
			params["order[pluggedInAt]"] = order_plugged_in_at

		try:
			response = requests.get(url, headers=self._get_headers(), params=params, timeout=30)
			response.raise_for_status()
			return response.json()
		except requests.exceptions.RequestException as e:
			frappe.log_error(f"Failed to get charge sessions: {str(e)}", "YesHugo API")
			return None

	def get_refuel_events(self, vehicle_id=None, page=1, items_per_page=100):
		"""
		Get refuel events.
		GET /refuel_events
		"""
		url = f"{self.BASE_URL}/refuel_events"
		params = {"page": page, "itemsPerPage": items_per_page}

		if vehicle_id:
			params["vehicle"] = f"/vehicles/{vehicle_id}"

		try:
			response = requests.get(url, headers=self._get_headers(), params=params, timeout=30)
			response.raise_for_status()
			return response.json()
		except requests.exceptions.RequestException as e:
			frappe.log_error(f"Failed to get refuel events: {str(e)}", "YesHugo API")
			return None

	def update_trip_comment(self, trip_id, comment):
		"""
		Update the comment field of a trip via PUT /trips/{id}

		Args:
			trip_id: The external YesHugo trip ID
			comment: The comment text to set

		Returns:
			Updated trip data or None on error
		"""
		url = f"{self.BASE_URL}/trips/{trip_id}"

		# Only send the comment field
		data = {"comment": comment}

		try:
			response = requests.put(url, headers=self._get_headers(), json=data, timeout=30)
			response.raise_for_status()
			return response.json()
		except requests.exceptions.RequestException as e:
			frappe.log_error(f"Failed to update trip comment {trip_id}: {str(e)}", "YesHugo API")
			return None
	
	def update_trip_reason(self, trip_id, reason):
		"""
		Update the reason (trip type) of a trip via PUT /trips/{id}

		Args:
			trip_id: The external YesHugo trip ID
			reason: The trip type - BUSINESS, PRIVATE, or COMMUTE

		Returns:
			Updated trip data or None on error
		"""
		url = f"{self.BASE_URL}/trips/{trip_id}"

		# API requires all related fields for the reason update
		if reason == "PRIVATE":
			data = {
				"reason": "PRIVATE",
				"businessDistanceInNonBusinessTrip": 0,
				"privateDistanceInNonPrivateTrip": None,
				"deviantDistance": 0,
				"deviantDescription": None
			}
		elif reason == "COMMUTE":
			data = {
				"reason": "COMMUTE",
				"businessDistanceInNonBusinessTrip": None,
				"privateDistanceInNonPrivateTrip": 0,
				"deviantDistance": 0,
				"deviantDescription": None
			}
		else:  # BUSINESS
			data = {
				"reason": "BUSINESS",
				"businessDistanceInNonBusinessTrip": None,
				"privateDistanceInNonPrivateTrip": 0,
				"deviantDistance": 0,
				"deviantDescription": None
			}

		try:
			response = requests.put(url, headers=self._get_headers(), json=data, timeout=30)
			response.raise_for_status()
			return response.json()
		except requests.exceptions.RequestException as e:
			frappe.log_error(f"Failed to update trip reason {trip_id}: {str(e)}", "YesHugo API")
			return None
		
# =============================================================================
# Helper Functions
# =============================================================================

def meters_to_km(meters):
	"""Convert meters to kilometers"""
	if meters is None:
		return None
	return meters / 1000.0


def haversine_distance(lat1, lon1, lat2, lon2):
	"""
	Calculate the distance between two GPS coordinates in meters.
	Uses the Haversine formula.
	"""
	if not all([lat1, lon1, lat2, lon2]):
		return float('inf')

	R = 6371000  # Earth radius in meters

	phi1 = math.radians(lat1)
	phi2 = math.radians(lat2)
	delta_phi = math.radians(lat2 - lat1)
	delta_lambda = math.radians(lon2 - lon1)

	a = math.sin(delta_phi / 2) ** 2 + \
		math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
	c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

	return R * c


def is_at_home(lat, lon):
	"""
	Check if the given coordinates are within the home radius.
	"""
	settings = frappe.get_single("YesHugo Settings")

	if not settings.home_latitude or not settings.home_longitude:
		return False

	distance = haversine_distance(
		lat, lon,
		settings.home_latitude, settings.home_longitude
	)

	radius = settings.home_radius or 100
	return distance <= radius


def parse_datetime(dt_str):
	"""
	Parse datetime string from API response.
	Handles timezone-aware datetime strings from YesHugo API,
	converts them to local timezone (Europe/Berlin), then to naive datetime for MySQL.
	"""
	if not dt_str:
		return None
	try:
		from zoneinfo import ZoneInfo

		# Parse the datetime string (handles timezone info)
		dt = dateutil_parser.parse(dt_str)

		# Convert to local timezone (Europe/Berlin) if timezone-aware
		if dt.tzinfo is not None:
			local_tz = ZoneInfo("Europe/Berlin")
			dt = dt.astimezone(local_tz)
			# Remove timezone info for MySQL DATETIME fields
			dt = dt.replace(tzinfo=None)

		return dt
	except Exception as e:
		frappe.log_error(f"Failed to parse datetime '{dt_str}': {str(e)}", "YesHugo Datetime Parse")
		return None


def extract_vehicle_id_from_iri(iri):
	"""Extract vehicle ID from IRI reference like '/vehicles/uuid'"""
	if not iri:
		return None
	if isinstance(iri, str) and iri.startswith("/vehicles/"):
		return iri.replace("/vehicles/", "")
	return iri


def format_address(address_obj):
	"""Format address object to string"""
	if not address_obj:
		return ""
	if isinstance(address_obj, str):
		return address_obj
	# Address object from YesHugo API
	# API uses: streetName, streetNumber, locality, postalCode, country
	parts = []

	# Street with number
	street_name = address_obj.get("streetName") or address_obj.get("street")
	street_number = address_obj.get("streetNumber") or address_obj.get("houseNumber")
	if street_name:
		if street_number:
			parts.append(f"{street_name} {street_number}")
		else:
			parts.append(street_name)

	# Postal code and city
	postal_code = address_obj.get("postalCode")
	city = address_obj.get("locality") or address_obj.get("city")
	if postal_code and city:
		parts.append(f"{postal_code} {city}")
	elif city:
		parts.append(city)
	elif postal_code:
		parts.append(postal_code)

	# Country (optional)
	if address_obj.get("country"):
		parts.append(address_obj.get("country"))

	return ", ".join(filter(None, parts))


def extract_coordinates(location):
	"""Extract lat/lon from GeoJSON Point or similar"""
	if not location:
		return None, None
	# GeoJSON Point format: {"type": "Point", "coordinates": [lon, lat]}
	if isinstance(location, dict):
		if location.get("type") == "Point" and location.get("coordinates"):
			coords = location["coordinates"]
			return coords[1], coords[0]  # GeoJSON is [lon, lat]
		return location.get("latitude"), location.get("longitude")
	return None, None


# =============================================================================
# Sync Functions
# =============================================================================

def sync_vehicles(client):
	"""
	Sync all vehicles from YesHugo to local DocType.
	Returns list of synced vehicle IDs.
	"""
	synced = []
	vehicles_data = client.get_vehicles()

	if not vehicles_data:
		return synced

	vehicles_list = client._extract_list(vehicles_data)

	for vehicle in vehicles_list:
		vehicle_id = str(vehicle.get("id", ""))
		if not vehicle_id:
			continue

		# Check if vehicle exists
		if frappe.db.exists("YesHugo Vehicle", vehicle_id):
			doc = frappe.get_doc("YesHugo Vehicle", vehicle_id)
		else:
			doc = frappe.new_doc("YesHugo Vehicle")
			doc.vehicle_id = vehicle_id

		# Update fields from API response
		doc.license_plate = vehicle.get("licensePlate", "")
		doc.description = vehicle.get("description", "")
		doc.archived = vehicle.get("archived", False)

		# Odometer (convert from meters to km)
		if vehicle.get("currentOdoValue"):
			doc.current_odometer = meters_to_km(vehicle.get("currentOdoValue"))
		if vehicle.get("currentOdoValueDate"):
			doc.current_odometer_date = parse_datetime(vehicle.get("currentOdoValueDate"))

		# Tank/Fuel data
		if vehicle.get("tankCapacity"):
			try:
				doc.tank_capacity = float(vehicle.get("tankCapacity"))
			except:
				pass
		if vehicle.get("averageFuelConsumption"):
			try:
				doc.average_fuel_consumption = float(vehicle.get("averageFuelConsumption"))
			except:
				pass

		doc.last_update = now_datetime()
		doc.save(ignore_permissions=True)
		synced.append(vehicle_id)

	frappe.db.commit()
	return synced


def _save_charge_session(session, vehicle_id):
	"""Save or update a single charge session from API data. Returns True if saved."""
	session_id = str(session.get("id", ""))
	if not session_id:
		return False

	existing = frappe.db.get_value("YesHugo Charge Session", {"external_id": session_id}, "name")
	if existing:
		doc = frappe.get_doc("YesHugo Charge Session", existing)
	else:
		doc = frappe.new_doc("YesHugo Charge Session")
		doc.external_id = session_id

	doc.vehicle = vehicle_id
	doc.plugged_in_at = parse_datetime(session.get("pluggedInAt"))
	doc.unplugged_at = parse_datetime(session.get("unpluggedAt"))
	if session.get("chargedKwh"):
		try:
			doc.charged_kwh = float(session.get("chargedKwh"))
		except (ValueError, TypeError):
			pass
	doc.charge_type = session.get("chargeType", "")
	doc.charge_limit = session.get("chargeLimit")
	doc.charged_over_limit = session.get("chargedOverLimit", False)
	doc.start_soc_percent = session.get("startStateOfChargePercent")
	doc.end_soc_percent = session.get("endStateOfChargePercent")
	doc.start_range_km = session.get("startRangeKm")
	doc.end_range_km = session.get("endRangeKm")
	lat, lon = extract_coordinates(session.get("location"))
	doc.latitude = lat
	doc.longitude = lon
	doc.address = format_address(session.get("address"))
	doc.save(ignore_permissions=True)
	return True


def sync_charge_sessions(client, vehicle_ids):
	"""
	Sync latest 100 charge sessions per vehicle from YesHugo (newest first).
	"""
	sessions_synced = 0

	for vehicle_id in vehicle_ids:
		sessions_data = client.get_charge_sessions(vehicle_id=vehicle_id, items_per_page=100, order_plugged_in_at="desc")

		if not sessions_data:
			continue

		sessions_list = client._extract_list(sessions_data)

		for session in sessions_list:
			if _save_charge_session(session, vehicle_id):
				sessions_synced += 1

	frappe.db.commit()
	return sessions_synced


def sync_all_trips(client, vehicle_ids):
	"""
	Sync ALL trips for given vehicles by paginating through all pages.
	"""
	trips_synced = 0

	for vehicle_id in vehicle_ids:
		page = 1
		while True:
			trips_data = client.get_trips(
				vehicle_id=vehicle_id, page=page, items_per_page=300,
				order_start_time="desc"
			)
			if not trips_data:
				break

			trips_list = client._extract_list(trips_data)
			if not trips_list:
				break

			for trip in trips_list:
				if _save_trip(trip, vehicle_id):
					trips_synced += 1

			total = client._extract_total(trips_data)
			if page * 300 >= total:
				break
			page += 1

	frappe.db.commit()
	return trips_synced


def sync_all_charge_sessions(client, vehicle_ids):
	"""
	Sync ALL charge sessions for given vehicles by paginating through all pages.
	"""
	sessions_synced = 0

	for vehicle_id in vehicle_ids:
		page = 1
		while True:
			sessions_data = client.get_charge_sessions(
				vehicle_id=vehicle_id, page=page, items_per_page=300,
				order_plugged_in_at="desc"
			)
			if not sessions_data:
				break

			sessions_list = client._extract_list(sessions_data)
			if not sessions_list:
				break

			for session in sessions_list:
				if _save_charge_session(session, vehicle_id):
					sessions_synced += 1

			total = client._extract_total(sessions_data)
			if page * 300 >= total:
				break
			page += 1

	frappe.db.commit()
	return sessions_synced


def _save_trip(trip, vehicle_id):
	"""Save or update a single trip from API data. Returns True if saved."""
	trip_id = str(trip.get("id", ""))
	if not trip_id:
		return False

	existing = frappe.db.get_value("YesHugo Trip", {"external_id": trip_id}, "name")
	if existing:
		doc = frappe.get_doc("YesHugo Trip", existing)
	else:
		doc = frappe.new_doc("YesHugo Trip")
		doc.external_id = trip_id

	doc.vehicle = vehicle_id
	doc.start_time = parse_datetime(trip.get("startTime"))
	doc.end_time = parse_datetime(trip.get("endTime"))
	doc.receiving_data = trip.get("receivingData", False)
	if doc.end_time and not doc.receiving_data:
		doc.status = "Completed"
	else:
		doc.status = "In Progress"
	doc.reason = trip.get("reason", "")
	if trip.get("distance"):
		doc.distance = meters_to_km(trip.get("distance"))
	if trip.get("businessDistance"):
		doc.business_distance = meters_to_km(trip.get("businessDistance"))
	if trip.get("privateDistance"):
		doc.private_distance = meters_to_km(trip.get("privateDistance"))
	if trip.get("commuteDistance"):
		doc.commute_distance = meters_to_km(trip.get("commuteDistance"))
	if trip.get("startOdoValue"):
		doc.start_odometer = meters_to_km(trip.get("startOdoValue"))
	if trip.get("endOdoValue"):
		doc.end_odometer = meters_to_km(trip.get("endOdoValue"))
	start_lat, start_lon = extract_coordinates(trip.get("startLocation"))
	end_lat, end_lon = extract_coordinates(trip.get("endLocation"))
	doc.start_latitude = start_lat
	doc.start_longitude = start_lon
	doc.end_latitude = end_lat
	doc.end_longitude = end_lon
	doc.start_address = format_address(trip.get("startAddress"))
	doc.end_address = format_address(trip.get("endAddress"))
	doc.comment = trip.get("comment", "")
	driver_iri = trip.get("driver")
	if driver_iri and isinstance(driver_iri, str):
		doc.driver = driver_iri.split("/")[-1] if "/" in driver_iri else driver_iri
	doc.save(ignore_permissions=True)
	return True


def sync_trips(client, vehicle_ids):
	"""
	Sync latest 100 trips per vehicle from YesHugo (newest first).
	"""
	trips_synced = 0

	for vehicle_id in vehicle_ids:
		trips_data = client.get_trips(vehicle_id=vehicle_id, items_per_page=100, order_start_time="desc")

		if not trips_data:
			continue

		trips_list = client._extract_list(trips_data)

		for trip in trips_list:
			if _save_trip(trip, vehicle_id):
				trips_synced += 1

	frappe.db.commit()
	return trips_synced


# =============================================================================
# Whitelist Functions (called from frontend)
# =============================================================================

@frappe.whitelist()
def test_connection():
	"""Test the YesHugo API connection"""
	try:
		client = YesHugoAPIClient()

		if not client.has_any_token():
			return {"success": False, "message": "Kein Token konfiguriert. Bitte JWT-Token oder X-Token eintragen."}

		# Try to get vehicles to verify access
		vehicles = client.get_vehicles(items_per_page=1)

		if vehicles is not None:
			total = client._extract_total(vehicles)
			token_type = "X-Token (persistent)" if client.has_persistent_token() else "JWT-Token (temporär)"
			return {
				"success": True,
				"message": f"Verbindung erfolgreich mit {token_type}! {total} Fahrzeug(e) gefunden."
			}
		else:
			return {"success": False, "message": "Fahrzeuge konnten nicht abgerufen werden. Token überprüfen."}

	except Exception as e:
		frappe.log_error(str(e), "YesHugo Connection Test")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def sync_yeshugo_data():
	"""Main sync function - syncs vehicles, trips, and charge sessions"""
	try:
		settings = frappe.get_single("YesHugo Settings")
		if not settings.enabled:
			return {"success": False, "message": "YesHugo integration is not enabled"}

		client = YesHugoAPIClient()

		sync_log = {
			"start_time": now_datetime().isoformat(),
			"vehicles_synced": 0,
			"trips_synced": 0,
			"charge_sessions_synced": 0,
			"errors": []
		}

		# Sync vehicles
		try:
			vehicle_ids = sync_vehicles(client)
			sync_log["vehicles_synced"] = len(vehicle_ids)
		except Exception as e:
			sync_log["errors"].append(f"Vehicle sync: {str(e)}")
			frappe.log_error(f"Error syncing vehicles: {str(e)}", "YesHugo Sync")
			vehicle_ids = []

		# Sync trips for each vehicle
		if vehicle_ids:
			try:
				trips_synced = sync_trips(client, vehicle_ids)
				sync_log["trips_synced"] = trips_synced
			except Exception as e:
				sync_log["errors"].append(f"Trip sync: {str(e)}")
				frappe.log_error(f"Error syncing trips: {str(e)}", "YesHugo Sync")

			# Sync charge sessions for each vehicle
			try:
				sessions_synced = sync_charge_sessions(client, vehicle_ids)
				sync_log["charge_sessions_synced"] = sessions_synced
			except Exception as e:
				sync_log["errors"].append(f"Charge session sync: {str(e)}")
				frappe.log_error(f"Error syncing charge sessions: {str(e)}", "YesHugo Sync")

		sync_log["end_time"] = now_datetime().isoformat()

		# Update settings
		settings.last_sync = now_datetime()
		settings.sync_status = f"Success: {sync_log['vehicles_synced']} vehicles, {sync_log['trips_synced']} trips, {sync_log['charge_sessions_synced']} charge sessions synced"
		settings.sync_log = json.dumps(sync_log, indent=2)
		settings.save(ignore_permissions=True)
		frappe.db.commit()

		return {
			"success": True,
			"message": settings.sync_status,
			"details": sync_log
		}

	except Exception as e:
		frappe.log_error(str(e), "YesHugo Sync Error")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def sync_yeshugo_data_full():
	"""Full sync - paginates through ALL trips and charge sessions"""
	try:
		settings = frappe.get_single("YesHugo Settings")
		if not settings.enabled:
			return {"success": False, "message": "YesHugo integration is not enabled"}

		client = YesHugoAPIClient()

		sync_log = {
			"start_time": now_datetime().isoformat(),
			"mode": "full",
			"vehicles_synced": 0,
			"trips_synced": 0,
			"charge_sessions_synced": 0,
			"errors": []
		}

		# Sync vehicles
		try:
			vehicle_ids = sync_vehicles(client)
			sync_log["vehicles_synced"] = len(vehicle_ids)
		except Exception as e:
			sync_log["errors"].append(f"Vehicle sync: {str(e)}")
			frappe.log_error(f"Error syncing vehicles: {str(e)}", "YesHugo Full Sync")
			vehicle_ids = []

		if vehicle_ids:
			try:
				trips_synced = sync_all_trips(client, vehicle_ids)
				sync_log["trips_synced"] = trips_synced
			except Exception as e:
				sync_log["errors"].append(f"Trip sync: {str(e)}")
				frappe.log_error(f"Error syncing trips: {str(e)}", "YesHugo Full Sync")

			try:
				sessions_synced = sync_all_charge_sessions(client, vehicle_ids)
				sync_log["charge_sessions_synced"] = sessions_synced
			except Exception as e:
				sync_log["errors"].append(f"Charge session sync: {str(e)}")
				frappe.log_error(f"Error syncing charge sessions: {str(e)}", "YesHugo Full Sync")

		sync_log["end_time"] = now_datetime().isoformat()

		settings.last_sync = now_datetime()
		settings.sync_status = f"Full Sync: {sync_log['vehicles_synced']} Fahrzeuge, {sync_log['trips_synced']} Fahrten, {sync_log['charge_sessions_synced']} Ladesitzungen"
		settings.sync_log = json.dumps(sync_log, indent=2)
		settings.save(ignore_permissions=True)
		frappe.db.commit()

		return {
			"success": True,
			"message": settings.sync_status,
			"details": sync_log
		}

	except Exception as e:
		frappe.log_error(str(e), "YesHugo Full Sync Error")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def get_current_vehicle_location():
	"""Get the current location of the first vehicle (for setting home location)"""
	try:
		client = YesHugoAPIClient()
		vehicles = client.get_vehicles(items_per_page=1)

		if not vehicles:
			return {"success": False, "message": "No vehicles found"}

		vehicles_list = client._extract_list(vehicles)

		if not vehicles_list:
			return {"success": False, "message": "No vehicles found"}

		vehicle = vehicles_list[0]
		vehicle_id = vehicle.get("id")

		# Try to get location from latest trip
		if vehicle_id:
			trips = client.get_trips(vehicle_id=vehicle_id, items_per_page=1)
			if trips:
				trips_list = client._extract_list(trips)
				if trips_list:
					trip = trips_list[0]
					lat, lon = extract_coordinates(trip.get("endLocation"))
					if lat and lon:
						return {
							"success": True,
							"latitude": lat,
							"longitude": lon
						}

		return {"success": False, "message": "No location data available"}

	except Exception as e:
		frappe.log_error(str(e), "YesHugo Get Location")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def get_vehicle_trips(vehicle_id, start_time_after=None, start_time_before=None):
	"""Get trips for a specific vehicle"""
	try:
		client = YesHugoAPIClient()
		trips = client.get_trips(
			vehicle_id=vehicle_id,
			start_time_after=start_time_after,
			start_time_before=start_time_before
		)
		return {"success": True, "data": trips}
	except Exception as e:
		frappe.log_error(str(e), "YesHugo Get Trips")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def get_vehicle_charges(vehicle_id):
	"""Get charging events for a vehicle"""
	try:
		client = YesHugoAPIClient()
		charges = client.get_charge_events(vehicle_id=vehicle_id)
		return {"success": True, "data": charges}
	except Exception as e:
		frappe.log_error(str(e), "YesHugo Get Charges")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def get_vehicle_refuels(vehicle_id):
	"""Get refuel events for a vehicle"""
	try:
		client = YesHugoAPIClient()
		refuels = client.get_refuel_events(vehicle_id=vehicle_id)
		return {"success": True, "data": refuels}
	except Exception as e:
		frappe.log_error(str(e), "YesHugo Get Refuels")
		return {"success": False, "message": str(e)}


# =============================================================================
# Scheduled Job
# =============================================================================

def scheduled_sync():
	"""
	Scheduled job for daily sync.
	Called by Frappe scheduler.

	IMPORTANT: Auto-Sync only works with persistent X-Token.
	JWT-Token expires after minutes and cannot be used for scheduled syncs.
	"""
	try:
		settings = frappe.get_single("YesHugo Settings")
		if not settings.enabled or not settings.auto_sync_enabled:
			return

		client = YesHugoAPIClient()

		# Auto-sync requires persistent X-Token
		if not client.has_persistent_token():
			frappe.log_error(
				"Auto-Sync übersprungen: Kein persistenter X-Token konfiguriert. "
				"JWT-Token ist für automatische Synchronisation nicht geeignet, da er nach wenigen Minuten abläuft.",
				"YesHugo Scheduled Sync"
			)
			return

		sync_yeshugo_data()
	except Exception as e:
		frappe.log_error(str(e), "YesHugo Scheduled Sync")
