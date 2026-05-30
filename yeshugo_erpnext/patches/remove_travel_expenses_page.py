import frappe


def execute():
	"""The 'YesHugo Travel Expenses' desk page was replaced by the
	'YesHugo Travel Expense Report' DocType. Remove the obsolete Page record."""
	if frappe.db.exists("Page", "yeshugo-travel-expenses"):
		frappe.delete_doc("Page", "yeshugo-travel-expenses", ignore_missing=True, force=True)
