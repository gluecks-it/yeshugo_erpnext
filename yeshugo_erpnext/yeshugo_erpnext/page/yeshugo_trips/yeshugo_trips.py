# Copyright (c) 2026, Gluecks IT and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import getdate, add_days, get_datetime, now_datetime, time_diff_in_seconds
from datetime import datetime, timedelta
import math


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


def is_at_home(lat, lon, home_lat, home_lon, home_radius):
	"""Check if coordinates are within home radius."""
	if not all([lat, lon, home_lat, home_lon]):
		return False
	distance = haversine_distance(lat, lon, home_lat, home_lon)
	return distance <= home_radius


def format_duration(seconds):
	"""Format seconds to HH:MM:SS or human readable format."""
	if seconds is None or seconds < 0:
		return "-"

	hours = int(seconds // 3600)
	minutes = int((seconds % 3600) // 60)
	secs = int(seconds % 60)

	if hours > 0:
		return f"{hours}h {minutes}m"
	elif minutes > 0:
		return f"{minutes}m"
	else:
		return f"{secs}s"


@frappe.whitelist()
def get_settings():
	"""Get YesHugo settings for the frontend."""
	settings = frappe.get_doc("YesHugo Settings", "YesHugo Settings", ignore_permissions=True)
	return {
		"home_latitude": settings.home_latitude,
		"home_longitude": settings.home_longitude,
		"home_radius": settings.home_radius or 100,
		"enabled": settings.enabled,
		"default_activity_type": settings.default_activity_type
	}


@frappe.whitelist()
def get_vehicles():
	"""Get list of vehicles visible to the current user.

	Fleet Manager sees all vehicles.
	Other users see vehicles with no employee or assigned to them.
	"""
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


def is_charging_during_stop(stop_start, stop_end, charge_sessions, vehicle_id):
	"""
	Check if a charge session overlaps with the stop time.
	Returns the charge session info if found, None otherwise.

	A stop is considered a charging stop if:
	- The charge session's plugged_in_at is during the stop
	- OR the stop time overlaps with the charging period
	"""
	if not stop_start or not stop_end or not charge_sessions:
		return None

	for session in charge_sessions:
		# Only check sessions for the same vehicle
		session_vehicle = session.get("vehicle")
		if session_vehicle and session_vehicle != vehicle_id:
			continue

		plugged_in = session.get("plugged_in_at")
		unplugged = session.get("unplugged_at")

		if not plugged_in:
			continue

		# Convert to datetime for comparison
		plugged_in_dt = get_datetime(plugged_in) if plugged_in else None
		unplugged_dt = get_datetime(unplugged) if unplugged else None
		stop_start_dt = get_datetime(stop_start) if isinstance(stop_start, str) else stop_start
		stop_end_dt = get_datetime(stop_end) if isinstance(stop_end, str) else stop_end

		if not plugged_in_dt or not stop_start_dt or not stop_end_dt:
			continue

		# Check for overlap: charge session overlaps with stop time
		# Overlap exists if: session_start < stop_end AND session_end > stop_start
		session_end = unplugged_dt or stop_end_dt  # If still charging, use stop end

		if plugged_in_dt < stop_end_dt and session_end > stop_start_dt:
			return session

	return None


@frappe.whitelist()
def get_charge_sessions(vehicle=None, from_date=None, to_date=None):
	"""
	Get charge sessions for the given date range.
	"""
	if not to_date:
		to_date = getdate(now_datetime())
	else:
		to_date = getdate(to_date)

	if not from_date:
		from_date = add_days(to_date, -30)
	else:
		from_date = getdate(from_date)

	filters = {
		"plugged_in_at": [">=", from_date],
	}

	if vehicle:
		filters["vehicle"] = vehicle

	sessions = frappe.get_all(
		"YesHugo Charge Session",
		filters=filters,
		fields=[
			"name", "vehicle", "external_id",
			"plugged_in_at", "unplugged_at",
			"charged_kwh", "charge_type",
			"start_soc_percent", "end_soc_percent",
			"latitude", "longitude", "address"
		],
		order_by="plugged_in_at desc",
		ignore_permissions=True
	)

	return sessions


@frappe.whitelist()
def get_trips_overview(vehicle=None, from_date=None, to_date=None, employee=None):
	"""
	Get trips overview with time calculations for stops outside home location.

	Returns trips grouped by day with:
	- All trips for the day
	- Time spent at stops outside home location (time between end of one trip and start of next)
	- Information about whether a stop is at a charging station

	Args:
		employee: Optional Employee name. If provided, checks ERPNext permissions
		         and filters trips by this employee's linked vehicles/driver field.
	"""
	# Permission check: if employee is specified, verify the current user has
	# permission to view that employee's data
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

	# Default date range: current week (Monday to Sunday)
	if not to_date:
		to_date = getdate(now_datetime())
	else:
		to_date = getdate(to_date)

	if not from_date:
		today = getdate(now_datetime())
		# Monday of current week (weekday(): 0=Mon, 6=Sun)
		from_date = add_days(today, -today.weekday())
	else:
		from_date = getdate(from_date)

	# Build filters - include trips that overlap with the date range
	# (a trip starting Sunday and ending Monday should appear in the Monday week)
	filters = {
		"status": "Completed",
		"end_time": [">=", from_date],
		"start_time": ["<=", add_days(to_date, 1)]
	}

	if vehicle:
		filters["vehicle"] = vehicle

	# Get all trips
	trips = frappe.get_all(
		"YesHugo Trip",
		filters=filters,
		fields=[
			"name", "vehicle", "external_id", "status", "reason",
			"start_time", "end_time", "distance",
			"start_latitude", "start_longitude", "start_address",
			"end_latitude", "end_longitude", "end_address",
			"business_distance", "private_distance", "commute_distance",
			"comment", "driver", "billed", "timesheet", "delivery_note"
		],
		order_by="start_time asc",
		ignore_permissions=True
	)

	# Get charge sessions for the date range (all vehicles if no filter)
	charge_session_filters = {
		"plugged_in_at": [">=", from_date],
	}
	if vehicle:
		charge_session_filters["vehicle"] = vehicle

	charge_sessions = frappe.get_all(
		"YesHugo Charge Session",
		filters=charge_session_filters,
		fields=["name", "vehicle", "plugged_in_at", "unplugged_at", "charged_kwh",
				"latitude", "longitude", "address", "charge_type",
				"start_soc_percent", "end_soc_percent"],
		ignore_permissions=True
	)

	# Get vehicle info
	vehicle_info = {}
	for v in frappe.get_all("YesHugo Vehicle", fields=["vehicle_id", "license_plate"], ignore_permissions=True):
		vehicle_info[v.vehicle_id] = v.license_plate

	# Group trips by day and vehicle
	days = {}

	for trip in trips:
		trip_start_date = getdate(trip.start_time)
		# For overnight trips that started before the range, group by arrival (end_time) date
		if trip_start_date < from_date and trip.end_time:
			trip_date = getdate(trip.end_time)
		else:
			trip_date = trip_start_date
		day_key = str(trip_date)
		vehicle_key = trip.vehicle

		if day_key not in days:
			days[day_key] = {
				"date": day_key,
				"vehicles": {}
			}

		if vehicle_key not in days[day_key]["vehicles"]:
			days[day_key]["vehicles"][vehicle_key] = {
				"vehicle_id": vehicle_key,
				"license_plate": vehicle_info.get(vehicle_key, vehicle_key),
				"trips": [],
				"stops_outside_home": [],
				"total_stop_time_outside": 0,
				"total_distance": 0,
				"total_driving_time": 0
			}

		# Check if start/end is at home
		trip["start_at_home"] = is_at_home(
			trip.start_latitude, trip.start_longitude,
			home_lat, home_lon, home_radius
		)
		trip["end_at_home"] = is_at_home(
			trip.end_latitude, trip.end_longitude,
			home_lat, home_lon, home_radius
		)

		# Calculate driving time
		if trip.start_time and trip.end_time:
			driving_seconds = time_diff_in_seconds(trip.end_time, trip.start_time)
			trip["driving_time"] = driving_seconds
			trip["driving_time_formatted"] = format_duration(driving_seconds)
			days[day_key]["vehicles"][vehicle_key]["total_driving_time"] += driving_seconds
		else:
			trip["driving_time"] = 0
			trip["driving_time_formatted"] = "-"

		# Add distance
		days[day_key]["vehicles"][vehicle_key]["total_distance"] += trip.distance or 0

		days[day_key]["vehicles"][vehicle_key]["trips"].append(trip)

	# Calculate stop times between trips (time outside home)
	for day_key, day_data in days.items():
		for vehicle_key, vehicle_data in day_data["vehicles"].items():
			trips_list = vehicle_data["trips"]

			for i in range(len(trips_list) - 1):
				current_trip = trips_list[i]
				next_trip = trips_list[i + 1]

				# Stop is from end of current trip to start of next trip
				if current_trip["end_time"] and next_trip["start_time"]:
					stop_start = get_datetime(current_trip["end_time"])
					stop_end = get_datetime(next_trip["start_time"])
					stop_seconds = (stop_end - stop_start).total_seconds()

					# Only count positive stop times
					if stop_seconds > 0:
						# Check if stop location is outside home
						stop_lat = current_trip["end_latitude"]
						stop_lon = current_trip["end_longitude"]
						at_home = is_at_home(stop_lat, stop_lon, home_lat, home_lon, home_radius)

						# Check if stop overlaps with a charging session (time-based)
						charge_session = is_charging_during_stop(
							stop_start, stop_end, charge_sessions, vehicle_key
						)

						stop_info = {
							"after_trip": current_trip["name"],
							"before_trip": next_trip["name"],
							"start_time": str(stop_start),
							"end_time": str(stop_end),
							"duration_seconds": stop_seconds,
							"duration_formatted": format_duration(stop_seconds),
							"location": current_trip["end_address"] or f"{stop_lat}, {stop_lon}",
							"latitude": stop_lat,
							"longitude": stop_lon,
							"at_home": at_home,
							"is_charging": charge_session is not None,
							"charge_session": charge_session
						}

						# Only add to list and count if NOT at home
						if not at_home:
							vehicle_data["stops_outside_home"].append(stop_info)
							# Don't count charging stops as billable time
							if not charge_session:
								vehicle_data["total_stop_time_outside"] += stop_seconds

			# Format totals
			vehicle_data["total_stop_time_outside_formatted"] = format_duration(
				vehicle_data["total_stop_time_outside"]
			)
			vehicle_data["total_driving_time_formatted"] = format_duration(
				vehicle_data["total_driving_time"]
			)
			vehicle_data["total_distance"] = round(vehicle_data["total_distance"], 1)

	# Convert to list and sort by date descending
	result = []
	for day_key in sorted(days.keys(), reverse=True):
		day_data = days[day_key]
		# Convert vehicles dict to list
		day_data["vehicles"] = list(day_data["vehicles"].values())
		result.append(day_data)

	return {
		"days": result,
		"settings": {
			"home_latitude": home_lat,
			"home_longitude": home_lon,
			"home_radius": home_radius
		}
	}


@frappe.whitelist()
def get_daily_summary(vehicle=None, from_date=None, to_date=None):
	"""
	Get a daily summary of trips with focus on time spent outside home.
	Simpler view showing totals per day.
	"""
	data = get_trips_overview(vehicle, from_date, to_date)

	summary = []
	for day in data["days"]:
		day_summary = {
			"date": day["date"],
			"vehicles": []
		}

		for v in day["vehicles"]:
			day_summary["vehicles"].append({
				"vehicle_id": v["vehicle_id"],
				"license_plate": v["license_plate"],
				"trip_count": len(v["trips"]),
				"total_distance": v["total_distance"],
				"total_driving_time": v["total_driving_time_formatted"],
				"total_stop_time_outside": v["total_stop_time_outside_formatted"],
				"stop_count_outside": len(v["stops_outside_home"])
			})

		summary.append(day_summary)

	return summary


@frappe.whitelist()
def get_activity_types():
	"""Get list of activity types for timesheet entries."""
	return frappe.get_all(
		"Activity Type",
		fields=["name", "activity_type"],
		order_by="name"
	)


@frappe.whitelist()
def get_current_employee():
	"""Get the employee record for the current user."""
	user = frappe.session.user
	employee = frappe.db.get_value(
		"Employee",
		{"user_id": user, "status": "Active"},
		["name", "employee_name", "company"],
		as_dict=True
	)
	return employee


def find_existing_timesheet(customer, employee, date):
	"""
	Find an existing draft timesheet for the customer/employee combination.

	Returns the timesheet name or None if not found.
	"""
	date = getdate(date)

	# Look for existing draft timesheet for this customer/employee
	existing = frappe.db.sql("""
		SELECT name
		FROM `tabTimesheet`
		WHERE employee = %(employee)s
		AND customer = %(customer)s
		AND docstatus = 0
		ORDER BY modified DESC
		LIMIT 1
	""", {
		"employee": employee,
		"customer": customer,
	}, as_dict=True)

	if existing:
		return existing[0].name
	return None


@frappe.whitelist()
def add_timesheet_entry(
	customer,
	from_time,
	duration_hours,
	activity_type,
	description,
	is_billable=1,
	project=None,
	trip_name=None,
	linked_trips=None,
	employee=None
):
	"""
	Add a timesheet entry for the specified or current user's employee.

	1. Find an existing draft timesheet for the customer or create a new one
	2. Add a new time log row
	3. Save the timesheet
	4. Optionally link the trip to the timesheet
	5. Link any additional trips (linked_trips) to the same timesheet

	Args:
		from_time: Start datetime
		duration_hours: Duration in hours (e.g. 2.5 for 2h 30m)
		trip_name: Optional YesHugo Trip name to mark as billed
		linked_trips: Optional list of additional trip names to link to the same timesheet
		employee: Optional Employee name. If provided, uses this employee instead of the current user's.
	"""
	# Get employee - use provided employee or fall back to current user's employee
	if employee:
		# Check permission for the specified employee
		if not frappe.has_permission("Employee", doc=employee, ptype="read"):
			frappe.throw(_("You do not have permission to create timesheets for this employee."),
				frappe.PermissionError)
		emp_data = frappe.db.get_value(
			"Employee", employee,
			["name", "employee_name", "company"],
			as_dict=True
		)
		if not emp_data:
			frappe.throw(_("Employee {0} not found").format(employee))
		employee = emp_data
	else:
		employee = get_current_employee()
		if not employee:
			frappe.throw(_("No active employee record found for current user"))

	# Get employee doc for company info
	emp = frappe.get_doc("Employee", employee.name)

	# Parse start time
	from_dt = get_datetime(from_time)

	# Calculate end time from duration
	hours = float(duration_hours)
	if hours <= 0:
		frappe.throw(_("Duration must be greater than 0"))

	to_dt = from_dt + timedelta(hours=hours)
	log_date = getdate(from_dt)

	# Prepare the time log entry
	time_log = {
		"activity_type": activity_type,
		"from_time": from_dt,
		"to_time": to_dt,
		"hours": hours,
		"description": description,
		"is_billable": int(is_billable),
		"project": project
	}

	# Try to find existing timesheet
	existing_ts = find_existing_timesheet(customer, employee.name, log_date)
	timesheet_created = False

	if existing_ts:
		# Add to existing timesheet
		ts = frappe.get_doc("Timesheet", existing_ts)
		ts.append("time_logs", time_log)

		# Update date range if needed
		if not ts.start_date or log_date < getdate(ts.start_date):
			ts.start_date = log_date
		if not ts.end_date or log_date > getdate(ts.end_date):
			ts.end_date = log_date

		ts.save(ignore_permissions=True)
	else:
		# Create new timesheet with the time log entry
		ts = frappe.new_doc("Timesheet")
		ts.employee = employee.name
		ts.customer = customer
		ts.company = emp.company
		ts.start_date = log_date
		ts.end_date = log_date
		ts.append("time_logs", time_log)
		ts.insert(ignore_permissions=True)
		timesheet_created = True

	# Get the timesheet detail name (last added row)
	timesheet_detail_name = ts.time_logs[-1].name if ts.time_logs else None

	# Build comment text for YesHugo API sync
	customer_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
	comment_text = f"{customer_name} {description}" if description else customer_name

	# Collect all trips to update (main trip + linked trips)
	all_trip_names = []
	if trip_name:
		all_trip_names.append(trip_name)

	# Parse linked_trips if provided (can be JSON string or list)
	if linked_trips:
		import json
		if isinstance(linked_trips, str):
			try:
				linked_trips = json.loads(linked_trips)
			except json.JSONDecodeError:
				linked_trips = []
		if isinstance(linked_trips, list):
			all_trip_names.extend(linked_trips)

	# Update all trips with timesheet reference and sync comment
	api_client = None
	for t_name in all_trip_names:
		try:
			trip = frappe.get_doc("YesHugo Trip", t_name)
			trip.timesheet = ts.name
			trip.timesheet_detail = timesheet_detail_name
			trip.billed = 1
			trip.comment = comment_text
			trip.save(ignore_permissions=True)

			# Sync comment to YesHugo API
			if trip.external_id:
				try:
					if api_client is None:
						from yeshugo_erpnext.yeshugo_erpnext.doctype.yeshugo_settings.yeshugo_api import YesHugoAPIClient
						api_client = YesHugoAPIClient()

					api_client.update_trip_comment(trip.external_id, comment_text)
				except Exception as api_error:
					frappe.log_error(f"Could not sync to YesHugo API for trip {t_name}: {str(api_error)}", "YesHugo API Sync")
		except Exception as e:
			frappe.log_error(f"Could not update trip {t_name}: {str(e)}", "YesHugo Trip Update")

	frappe.db.commit()

	return {
		"success": True,
		"timesheet": ts.name,
		"timesheet_created": timesheet_created,
		"hours": round(hours, 2),
		"comment": comment_text,
		"message": _("Time entry added to timesheet {0}").format(ts.name)
	}


@frappe.whitelist()
def get_open_timesheets_for_customer(customer):
	"""Get list of open (draft) timesheets for a customer."""
	timesheets = frappe.get_all(
		"Timesheet",
		filters={
			"customer": customer,
			"docstatus": 0
		},
		fields=["name", "employee", "employee_name", "start_date", "end_date", "total_hours"],
		order_by="modified desc",
		limit=10
	)
	return timesheets


@frappe.whitelist()
def get_projects_for_customer(customer):
	"""Get active projects for a customer."""
	projects = frappe.get_all(
		"Project",
		filters={
			"customer": customer,
			"status": ["not in", ["Completed", "Cancelled"]]
		},
		fields=["name", "project_name", "status"],
		order_by="project_name"
	)
	return projects


@frappe.whitelist()
def update_trip_reason(trip_name, reason):
	"""
	Update the trip type/reason for a trip.

	Args:
		trip_name: The local YesHugo Trip document name
		reason: The trip type - BUSINESS, PRIVATE, or COMMUTE

	Returns:
		Success status and message
	"""
	if reason not in ["BUSINESS", "PRIVATE", "COMMUTE"]:
		return {"success": False, "message": _("Invalid trip type. Must be BUSINESS, PRIVATE, or COMMUTE.")}

	try:
		trip = frappe.get_doc("YesHugo Trip", trip_name)

		# Update in YesHugo API
		if trip.external_id:
			from yeshugo_erpnext.yeshugo_erpnext.doctype.yeshugo_settings.yeshugo_api import YesHugoAPIClient
			client = YesHugoAPIClient()
			result = client.update_trip_reason(trip.external_id, reason)

			if not result:
				return {"success": False, "message": _("Failed to update in YesHugo API")}

		# Update local record
		trip.reason = reason
		trip.save(ignore_permissions=True)
		frappe.db.commit()

		return {
			"success": True,
			"message": _("Trip type updated successfully"),
			"reason": reason
		}

	except Exception as e:
		frappe.log_error(f"Error updating trip reason: {str(e)}", "YesHugo Trip Update")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def update_trip_comment(trip_name, comment):
	"""
	Update the comment for a trip and sync to YesHugo API.

	Args:
		trip_name: The local YesHugo Trip document name
		comment: The new comment text

	Returns:
		Success status and message
	"""
	try:
		trip = frappe.get_doc("YesHugo Trip", trip_name)

		# Update in YesHugo API
		if trip.external_id:
			from yeshugo_erpnext.yeshugo_erpnext.doctype.yeshugo_settings.yeshugo_api import YesHugoAPIClient
			client = YesHugoAPIClient()
			client.update_trip_comment(trip.external_id, comment)

		# Update local record
		trip.comment = comment
		trip.save(ignore_permissions=True)
		frappe.db.commit()

		return {
			"success": True,
			"message": _("Comment updated successfully"),
			"comment": comment
		}

	except Exception as e:
		frappe.log_error(f"Error updating trip comment: {str(e)}", "YesHugo Trip Update")
		return {"success": False, "message": str(e)}


@frappe.whitelist()
def create_delivery_note(customer, items_json, posting_date=None, project=None, trip_name=None):
	"""
	Create a Delivery Note as draft from the trips page.

	Args:
		customer: Customer name
		items_json: JSON string of items [{"item_code": "...", "qty": 1}, ...]
		posting_date: Optional posting date (uses today if not set)
		project: Optional project link
		trip_name: Optional trip name to link

	Returns:
		Success status with delivery note name
	"""
	import json

	try:
		items = json.loads(items_json) if isinstance(items_json, str) else items_json

		if not items:
			return {"success": False, "message": _("Please add at least one item")}

		employee = get_current_employee()
		if not employee:
			return {"success": False, "message": _("No employee record found for current user")}

		emp = frappe.get_doc("Employee", employee.name)

		dn = frappe.new_doc("Delivery Note")
		dn.customer = customer
		dn.company = emp.company

		if posting_date:
			dn.posting_date = getdate(posting_date)
			dn.set_posting_time = 1

		for item in items:
			item_code = item.get("item_code")
			qty = float(item.get("qty", 1))

			if not item_code or qty <= 0:
				continue

			row = {"item_code": item_code, "qty": qty}

			if project:
				row["project"] = project

			dn.append("items", row)

		if not dn.items:
			return {"success": False, "message": _("No valid items to add")}

		dn.insert(ignore_permissions=True)

		# Link delivery note to trip
		if trip_name:
			frappe.db.set_value("YesHugo Trip", trip_name, "delivery_note", dn.name)

		frappe.db.commit()

		return {
			"success": True,
			"delivery_note": dn.name,
			"message": _("Delivery Note {0} created as draft").format(dn.name)
		}

	except Exception as e:
		frappe.log_error(f"Error creating delivery note: {str(e)}", "YesHugo Delivery Note")
		return {"success": False, "message": str(e)}
