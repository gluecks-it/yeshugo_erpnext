import frappe
import json
import os


def after_migrate():
	create_custom_roles()
	sync_page_roles()
	reload_workspace()


def create_custom_roles():
	"""Create custom roles needed by YesHugo."""
	for role_name in ["Pool Vehicle User"]:
		if not frappe.db.exists("Role", role_name):
			frappe.get_doc({"doctype": "Role", "role_name": role_name}).insert(ignore_permissions=True)
	frappe.db.commit()


def sync_page_roles():
	"""Sync page roles from JSON files to database for all YesHugo pages."""
	pages_dir = os.path.join(os.path.dirname(__file__), "yeshugo_erpnext", "page")
	if not os.path.exists(pages_dir):
		return

	for page_folder in os.listdir(pages_dir):
		json_path = os.path.join(pages_dir, page_folder, f"{page_folder}.json")
		if not os.path.exists(json_path):
			continue

		with open(json_path, "r") as f:
			page_data = json.load(f)

		page_name = page_data.get("name")
		if not page_name or not frappe.db.exists("Page", page_name):
			continue

		page = frappe.get_doc("Page", page_name)
		page.roles = []
		for role_entry in page_data.get("roles", []):
			page.append("roles", {"role": role_entry["role"]})
		page.save(ignore_permissions=True)

	frappe.db.commit()


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
