import frappe
import json
import os


def after_migrate():
	reload_workspace()


def reload_workspace():
	"""Delete and recreate YesHugo workspace from JSON file"""
	workspace_name = "YesHugo"

	if frappe.db.exists("Workspace", workspace_name):
		frappe.delete_doc("Workspace", workspace_name, force=True, ignore_permissions=True)
		frappe.db.commit()

	json_path = os.path.join(
		os.path.dirname(__file__),
		"yeshugo_erpnext",
		"workspace",
		"yeshugo_erpnext",
		"yeshugo_erpnext.json"
	)

	if not os.path.exists(json_path):
		frappe.log_error(f"Workspace JSON not found: {json_path}")
		return

	with open(json_path, "r") as f:
		workspace_data = json.load(f)

	workspace = frappe.new_doc("Workspace")
	workspace.update(workspace_data)
	workspace.insert(ignore_permissions=True)
	frappe.db.commit()
