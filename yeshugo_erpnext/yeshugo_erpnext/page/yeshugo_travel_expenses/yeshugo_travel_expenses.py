import frappe
from frappe import _
from frappe.utils import getdate, get_datetime, now_datetime, time_diff_in_seconds
from datetime import datetime
import calendar
import math


def haversine_distance(lat1, lon1, lat2, lon2):
	if not all([lat1, lon1, lat2, lon2]):
		return float('inf')
	R = 6371000
	phi1 = math.radians(lat1)
	phi2 = math.radians(lat2)
	delta_phi = math.radians(lat2 - lat1)
	delta_lambda = math.radians(lon2 - lon1)
	a = math.sin(delta_phi / 2) ** 2 + \
		math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
	c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
	return R * c


def is_at_home(lat, lon, home_lat, home_lon, home_radius):
	if not all([lat, lon, home_lat, home_lon]):
		return False
	return haversine_distance(lat, lon, home_lat, home_lon) <= home_radius


@frappe.whitelist()
def get_current_employee():
	user = frappe.session.user
	employee = frappe.db.get_value(
		"Employee",
		{"user_id": user, "status": "Active"},
		["name", "employee_name", "company"],
		as_dict=True
	)
	return employee


@frappe.whitelist()
def get_vehicles():
	"""Get list of vehicles visible to the current user."""
	vehicles = frappe.get_all(
		"YesHugo Vehicle",
		filters={"archived": 0},
		fields=["vehicle_id", "license_plate", "description", "employee"],
		order_by="license_plate",
		ignore_permissions=True
	)

	roles = frappe.get_roles()

	# Fleet Manager and System Manager see everything
	if "Fleet Manager" in roles or "System Manager" in roles:
		return vehicles

	employee = get_current_employee()
	employee_name = employee.get("name") if employee else None

	# Pool Vehicle User sees unassigned (pool) vehicles + own vehicle
	if "Pool Vehicle User" in roles:
		return [v for v in vehicles if not v.employee or v.employee == employee_name]

	# Everyone else sees only their own assigned vehicle
	return [v for v in vehicles if v.employee == employee_name]


@frappe.whitelist()
def get_travel_expenses(month=None, year=None, vehicle=None, employee=None,
						reason_filter=None):
	"""
	Get travel expense report for a given month.

	Groups consecutive trips into journeys (home -> destinations -> home).
	Returns a flat list of rows like the PDF Reisespesenabrechnung:
	  Datum | Kunde/Zweck | Kilometer | Erstattung

	Args:
		month: Month number (1-12)
		year: Year (e.g. 2026)
		vehicle: Optional vehicle_id filter
		employee: Optional Employee name for permission check
		reason_filter: Optional - "BUSINESS", "PRIVATE", "COMMUTE" or None for all
	"""
	if employee:
		if not frappe.has_permission("Employee", doc=employee, ptype="read"):
			frappe.throw(
				_("You do not have permission to view data for this employee."),
				frappe.PermissionError
			)

	settings = frappe.get_doc("YesHugo Settings", "YesHugo Settings", ignore_permissions=True)
	home_lat = settings.home_latitude
	home_lon = settings.home_longitude
	home_radius = settings.home_radius or 100

	# Default to current month
	today = getdate(now_datetime())
	if not month:
		month = today.month
	else:
		month = int(month)
	if not year:
		year = today.year
	else:
		year = int(year)

	last_day = calendar.monthrange(year, month)[1]

	# Query trips with LEFT JOIN to Timesheet for customer info
	conditions = [
		"status = 'Completed'",
		"start_time >= %(from_date)s",
		"start_time <= %(to_date)s"
	]
	params = {
		"from_date": getdate(f"{year}-{month:02d}-01"),
		"to_date": datetime(year, month, last_day, 23, 59, 59)
	}

	if vehicle:
		conditions.append("vehicle = %(vehicle)s")
		params["vehicle"] = vehicle

	if reason_filter:
		conditions.append("reason = %(reason)s")
		params["reason"] = reason_filter

	trips = frappe.db.sql("""
		SELECT
			name, vehicle, reason,
			start_time, end_time, distance,
			start_address, end_address,
			business_distance, private_distance, commute_distance,
			comment, driver
		FROM `tabYesHugo Trip`
		WHERE {conditions}
		ORDER BY vehicle, start_time ASC
	""".format(conditions=" AND ".join(conditions)), params, as_dict=True)

	# Get vehicle info
	vehicle_info = {}
	for v in frappe.get_all("YesHugo Vehicle", fields=["vehicle_id", "license_plate"], ignore_permissions=True):
		vehicle_info[v.vehicle_id] = v.license_plate

	# Load all customer names for matching against comments
	# Sort by length descending so longer names match first
	# (e.g. "Kago GmbH & Co. KG" before "Kago GmbH")
	all_customers = frappe.get_all("Customer", fields=["name", "customer_name"])
	customer_name_list = sorted(
		[c.customer_name for c in all_customers if c.customer_name],
		key=len, reverse=True
	)

	def extract_customer(comment):
		"""Check if comment starts with a known customer name.
		Returns (customer_name, is_matched)."""
		if not comment:
			return "", False
		comment_stripped = comment.strip()
		for cname in customer_name_list:
			if comment_stripped.startswith(cname):
				return cname, True
		return comment_stripped, False

	# Group trips by day + customer into one row each
	# Key: (date, customer_text) -> aggregated row
	from collections import OrderedDict
	grouped = OrderedDict()

	for trip in trips:
		trip_date = str(getdate(trip.start_time))

		# Determine customer text:
		# 1. Check if comment starts with a known customer name
		# 2. Fall back to full comment
		# 3. Fall back to end_address (marked as fallback)
		customer, is_matched = extract_customer(trip.comment)
		is_fallback = False
		if not customer:
			customer = (trip.end_address or "").strip()
			is_fallback = True
		if not customer:
			customer = "-"
			is_fallback = True

		group_key = (trip_date, customer)

		if group_key not in grouped:
			grouped[group_key] = {
				"date": trip_date,
				"customer": customer,
				"km": 0,
				"trip_count": 0,
				"reason": trip.reason or "",
				"license_plate": vehicle_info.get(trip.vehicle, trip.vehicle),
				"is_fallback": is_fallback
			}

		# Use the distance field matching the reason filter
		if reason_filter == "BUSINESS":
			km = trip.business_distance or 0
		elif reason_filter == "PRIVATE":
			km = trip.private_distance or 0
		elif reason_filter == "COMMUTE":
			km = trip.commute_distance or 0
		else:
			km = trip.distance or 0
		grouped[group_key]["km"] += km
		grouped[group_key]["trip_count"] += 1

	# Build flat rows sorted by date
	rows = []
	total_km = 0

	for group_key in grouped:
		row = grouped[group_key]
		row["km"] = round(row["km"])
		rows.append(row)
		total_km += row["km"]

	# Get employee name for the header
	employee_name = ""
	if employee:
		employee_name = frappe.db.get_value("Employee", employee, "employee_name") or ""

	return {
		"rows": rows,
		"total_km": total_km,
		"month": month,
		"year": year,
		"month_name": get_month_name(month),
		"employee_name": employee_name
	}


def get_month_name(month):
	names = [
		"", "Januar", "Februar", "M\u00e4rz", "April", "Mai", "Juni",
		"Juli", "August", "September", "Oktober", "November", "Dezember"
	]
	return names[month]
