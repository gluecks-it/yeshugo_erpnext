# Copyright (c) 2026, Gluecks IT and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, add_days, flt


class YesHugoTravelExpenseReport(Document):
	def validate(self):
		if self.from_date and self.to_date and getdate(self.from_date) > getdate(self.to_date):
			frappe.throw(_("'Von Datum' muss vor 'Bis Datum' liegen."))

		if self.employee and not self.company:
			self.company = frappe.db.get_value("Employee", self.employee, "company")

		# On every save of a draft, (re)fetch the business trips for the period.
		if self.docstatus == 0:
			self.fetch_business_trips()

		self.calculate_totals()

	def calculate_totals(self):
		total_km = 0.0
		total_reimbursement = 0.0
		rate = flt(self.rate_per_km)
		for row in self.rows:
			row.reimbursement = flt(row.km) * rate
			total_km += flt(row.km)
			total_reimbursement += flt(row.reimbursement)
		self.total_km = total_km
		self.total_reimbursement = total_reimbursement

	def fetch_business_trips(self):
		"""Pull all business trips of the employee in the period into the rows table.

		Only the business portion counts (distance minus a recorded private split),
		and trips already locked on another report are skipped.
		"""
		self.set("rows", [])

		if not (self.employee and self.from_date and self.to_date):
			return

		# Employee -> assigned vehicles -> trips
		vehicles = frappe.get_all(
			"YesHugo Vehicle", filters={"employee": self.employee}, pluck="vehicle_id"
		)
		if not vehicles:
			return

		trips = frappe.get_all(
			"YesHugo Trip",
			filters=[
				["vehicle", "in", vehicles],
				["status", "=", "Completed"],
				["reason", "=", "BUSINESS"],
				["start_time", ">=", getdate(self.from_date)],
				["start_time", "<", add_days(getdate(self.to_date), 1)],
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
			if trip.travel_expense_report and trip.travel_expense_report != self.name:
				continue

			# Business portion: full distance minus a recorded private split
			if flt(trip.private_distance) > 0:
				km = max(0.0, flt(trip.distance) - flt(trip.private_distance))
			else:
				km = flt(trip.distance)
			if km <= 0:
				continue

			customer = _extract_customer(trip.comment, customer_names)
			if not customer:
				customer = (trip.end_address or "").strip() or "-"

			self.append("rows", {
				"trip": trip.name,
				"trip_date": getdate(trip.start_time),
				"customer": customer,
				"km": km,
			})

	def on_submit(self):
		"""Festschreiben: lock the included trips against being reused elsewhere."""
		for row in self.rows:
			if not row.trip:
				continue
			locked_on = frappe.db.get_value("YesHugo Trip", row.trip, "travel_expense_report")
			if locked_on and locked_on != self.name:
				frappe.throw(
					_("Fahrt {0} ist bereits in Abrechnung {1} festgeschrieben.").format(
						row.trip, locked_on
					)
				)

		for row in self.rows:
			if row.trip:
				frappe.db.set_value("YesHugo Trip", row.trip, "travel_expense_report", self.name)

	def on_cancel(self):
		"""Reverse the lock when the report is cancelled."""
		for row in self.rows:
			if row.trip:
				frappe.db.set_value("YesHugo Trip", row.trip, "travel_expense_report", None)


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
