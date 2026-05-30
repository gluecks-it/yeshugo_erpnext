// Copyright (c) 2026, Gluecks IT and contributors
// For license information, please see license.txt

frappe.ui.form.on("YesHugo Travel Expense Report", {
	refresh(frm) {
		if (frm.doc.docstatus === 0) {
			frm.add_custom_button(__("Fahrten holen"), () => get_trips(frm));
		}
	},
});

function get_trips(frm) {
	if (!frm.doc.employee || !frm.doc.from_date || !frm.doc.to_date) {
		frappe.msgprint(__("Bitte Mitarbeiter, Von-Datum und Bis-Datum setzen."));
		return;
	}

	const fetch = () =>
		frm.call("get_trips").then(() => frm.reload_doc());

	// Make sure employee/dates are persisted before fetching, then reload.
	if (frm.is_new() || frm.is_dirty()) {
		frm.save().then(fetch);
	} else {
		fetch();
	}
}
