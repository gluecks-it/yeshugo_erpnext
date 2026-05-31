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

	frappe.call({
		method: "yeshugo_erpnext.yeshugo_erpnext.doctype.yeshugo_travel_expense_report.yeshugo_travel_expense_report.get_trip_rows",
		args: {
			employee: frm.doc.employee,
			from_date: frm.doc.from_date,
			to_date: frm.doc.to_date,
			rate_per_km: frm.doc.rate_per_km,
			report: frm.doc.name,
		},
		freeze: true,
		freeze_message: __("Hole Fahrten..."),
		callback(r) {
			const rows = r.message || [];
			// Fill the grid client-side; nothing is saved - the user reviews,
			// deletes unwanted lines and saves when ready.
			frm.clear_table("rows");
			rows.forEach((row) => frm.add_child("rows", row));
			frm.refresh_field("rows");
			frm.dirty();
			frappe.show_alert({
				message: __("{0} Zeile(n) geholt - bitte prüfen und speichern.", [rows.length]),
				indicator: "green",
			});
		},
	});
}
