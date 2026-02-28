# Copyright (c) 2026, Gluecks IT and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class YesHugoTrip(Document):
	def before_save(self):
		self.calculate_totals()

	def calculate_totals(self):
		# Calculate distance from odometer if not set
		if self.start_odometer and self.end_odometer and not self.distance:
			self.distance = self.end_odometer - self.start_odometer

		# Calculate duration
		if self.start_time and self.end_time:
			from frappe.utils import time_diff_in_seconds
			diff_seconds = time_diff_in_seconds(self.end_time, self.start_time)
			self.duration_minutes = int(diff_seconds / 60) if diff_seconds > 0 else 0


def on_timesheet_delete(doc, method):
	"""Called when a Timesheet is deleted. Clears the link in all related YesHugo Trips."""
	trips = frappe.get_all(
		"YesHugo Trip",
		filters={"timesheet": doc.name},
		pluck="name"
	)

	for trip_name in trips:
		frappe.db.set_value(
			"YesHugo Trip",
			trip_name,
			{
				"timesheet": None,
				"timesheet_detail": None,
				"billed": 0
			},
			update_modified=False
		)

	if trips:
		frappe.db.commit()


def on_delivery_note_delete(doc, method):
	"""Called when a Delivery Note is deleted. Clears the link in all related YesHugo Trips."""
	trips = frappe.get_all(
		"YesHugo Trip",
		filters={"delivery_note": doc.name},
		pluck="name"
	)

	for trip_name in trips:
		frappe.db.set_value(
			"YesHugo Trip",
			trip_name,
			{"delivery_note": None},
			update_modified=False
		)

	if trips:
		frappe.db.commit()


@frappe.whitelist()
def unlink_timesheet(trip_name):
	"""Remove the timesheet link from a YesHugo Trip."""
	trip = frappe.get_doc("YesHugo Trip", trip_name)

	if not trip.timesheet:
		return {"success": False, "message": _("Trip is not linked to a timesheet")}

	trip.timesheet = None
	trip.timesheet_detail = None
	trip.billed = 0
	trip.save(ignore_permissions=True)
	frappe.db.commit()

	return {"success": True, "message": _("Timesheet link removed successfully")}
