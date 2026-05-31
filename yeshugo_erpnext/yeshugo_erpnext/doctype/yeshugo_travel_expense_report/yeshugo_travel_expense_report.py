# Copyright (c) 2026, Gluecks IT and contributors
# For license information, please see license.txt

from collections import OrderedDict

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, add_days, flt


class YesHugoTravelExpenseReport(Document):
	def validate(self):
		if self.from_date and self.to_date and getdate(self.from_date) > getdate(self.to_date):
			frappe.throw(_("'From Date' must be before 'To Date'."))

		if self.employee and not self.company:
			self.company = frappe.db.get_value("Employee", self.employee, "company")

		self.calculate_totals()

	def calculate_totals(self):
		rate = flt(self.rate_per_km)
		total_km = 0.0
		total_reimbursement = 0.0
		for row in self.rows:
			row.reimbursement = flt(row.km) * rate
			total_km += flt(row.km)
			total_reimbursement += flt(row.reimbursement)
		self.total_km = total_km
		self.total_reimbursement = total_reimbursement

	def on_submit(self):
		"""Festschreiben: lock the trips of the kept lines and stamp each with this
		report + its line (Timesheet / timesheet_detail pattern). Trips of lines the
		user deleted (e.g. billed to another company) stay free."""
		row_name_by_key = {(getdate(r.trip_date), r.customer): r.name for r in self.rows}
		groups = _group_business_trips(self.employee, self.from_date, self.to_date, self.name)

		# Guard against double-booking (only for kept lines)
		for key, group in groups.items():
			if key not in row_name_by_key:
				continue
			for name in group["trips"]:
				locked_on = frappe.db.get_value("YesHugo Trip", name, "travel_expense_report")
				if locked_on and locked_on != self.name:
					frappe.throw(
						_("Trip {0} is already locked in report {1}.").format(name, locked_on)
					)

		for key, group in groups.items():
			row_name = row_name_by_key.get(key)
			if not row_name:
				continue  # line was deleted -> leave these trips free
			for name in group["trips"]:
				frappe.db.set_value("YesHugo Trip", name, {
					"travel_expense_report": self.name,
					"travel_expense_report_detail": row_name,
				})

	def on_cancel(self):
		"""Cancelling frees the locked trips."""
		self._free_locked_trips()

	def on_trash(self):
		"""Deleting also frees any trips still stamped with this report."""
		self._free_locked_trips()

	def _free_locked_trips(self):
		"""Clear the report stamp from every trip locked to this report."""
		locked = frappe.get_all(
			"YesHugo Trip", filters={"travel_expense_report": self.name}, pluck="name"
		)
		for name in locked:
			frappe.db.set_value("YesHugo Trip", name, {
				"travel_expense_report": None,
				"travel_expense_report_detail": None,
			})


@frappe.whitelist()
def get_trip_rows(employee, from_date, to_date, rate_per_km=0.30, report=None):
	"""Read-only: return the consolidated rows (per day + customer) for the period.

	Does NOT create, mutate or save any document. The client form fills the grid
	with the returned rows, and the user saves when ready - so nothing is changed
	in the background and frontend edits are never overwritten.
	"""
	rate = flt(rate_per_km)
	rows = []
	for (trip_date, customer), group in _group_business_trips(
		employee, from_date, to_date, report
	).items():
		km = round(group["km"])
		rows.append({
			"trip_date": trip_date,
			"customer": customer,
			"km": km,
			"reimbursement": km * rate,
		})
	return rows


def _group_business_trips(employee, from_date, to_date, report=None):
	"""Group the employee's business trips in the period by (date, customer).

	Returns OrderedDict {(date, customer): {"km": float, "trips": [trip names]}}.
	Only the business portion counts (distance minus a recorded private split);
	trips already locked on another report are skipped.
	"""
	groups = OrderedDict()
	if not (employee and from_date and to_date):
		return groups

	vehicles = frappe.get_all(
		"YesHugo Vehicle", filters={"employee": employee}, pluck="vehicle_id"
	)
	if not vehicles:
		return groups

	trips = frappe.get_all(
		"YesHugo Trip",
		filters=[
			["vehicle", "in", vehicles],
			["status", "=", "Completed"],
			["reason", "=", "BUSINESS"],
			["start_time", ">=", getdate(from_date)],
			["start_time", "<", add_days(getdate(to_date), 1)],
		],
		fields=[
			"name", "start_time", "distance", "private_distance",
			"comment", "end_address", "travel_expense_report",
		],
		order_by="start_time asc",
	)

	customer_names = _get_customer_name_list()

	for trip in trips:
		# Skip trips already locked on another report
		if trip.travel_expense_report and trip.travel_expense_report != report:
			continue

		if flt(trip.private_distance) > 0:
			km = max(0.0, flt(trip.distance) - flt(trip.private_distance))
		else:
			km = flt(trip.distance)
		if km <= 0:
			continue

		customer = _extract_customer(trip.comment, customer_names)
		if not customer:
			customer = (trip.end_address or "").strip() or "-"

		key = (getdate(trip.start_time), customer)
		group = groups.setdefault(key, {"km": 0.0, "trips": []})
		group["km"] += km
		group["trips"].append(trip.name)

	return groups


def _get_customer_name_list():
	"""Customer names sorted longest-first so 'Kago GmbH & Co. KG' matches before 'Kago GmbH'."""
	customers = frappe.get_all("Customer", fields=["customer_name"])
	return sorted(
		[c.customer_name for c in customers if c.customer_name], key=len, reverse=True
	)


def _extract_customer(comment, customer_names):
	"""Return the known customer name a comment starts with, else the trimmed comment."""
	if not comment:
		return ""
	stripped = comment.strip()
	for name in customer_names:
		if stripped.startswith(name):
			return name
	return stripped
