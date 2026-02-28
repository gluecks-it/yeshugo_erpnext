// Copyright (c) 2026, Gluecks IT and contributors
// For license information, please see license.txt

frappe.ui.form.on("YesHugo Trip", {
	refresh(frm) {
		if (frm.doc.timesheet && !frm.is_new()) {
			frm.add_custom_button(__("Zeiterfassung entfernen"), function() {
				frappe.confirm(
					__("Möchten Sie die Verknüpfung zur Zeiterfassung {0} wirklich entfernen?", [frm.doc.timesheet]),
					function() {
						frappe.call({
							method: "yeshugo_erpnext.yeshugo_erpnext.doctype.yeshugo_trip.yeshugo_trip.unlink_timesheet",
							args: {
								trip_name: frm.doc.name
							},
							callback: function(r) {
								if (r.message && r.message.success) {
									frappe.show_alert({
										message: r.message.message,
										indicator: "green"
									});
									frm.reload_doc();
								} else {
									frappe.msgprint(r.message.message || __("Fehler beim Entfernen der Verknüpfung"));
								}
							}
						});
					}
				);
			}, __("Aktionen"));
		}
	}
});
