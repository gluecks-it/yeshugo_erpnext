// Copyright (c) 2026, Gluecks IT and contributors
// For license information, please see license.txt

frappe.ui.form.on('YesHugo Settings', {
	refresh: function(frm) {
		// Test Connection button
		frm.add_custom_button(__('Test Connection'), function() {
			frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.doctype.yeshugo_settings.yeshugo_api.test_connection',
				freeze: true,
				freeze_message: __('Testing connection...'),
				callback: function(r) {
					if (r.message && r.message.success) {
						frappe.msgprint({
							title: __('Success'),
							indicator: 'green',
							message: r.message.message
						});
					} else {
						frappe.msgprint({
							title: __('Error'),
							indicator: 'red',
							message: r.message ? r.message.message : __('Connection failed')
						});
					}
				}
			});
		});

		// Sync Now button
		frm.add_custom_button(__('Sync Now'), function() {
			frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.doctype.yeshugo_settings.yeshugo_api.sync_yeshugo_data',
				freeze: true,
				freeze_message: __('Syncing YesHugo data...'),
				callback: function(r) {
					if (r.message && r.message.success) {
						frappe.msgprint({
							title: __('Success'),
							indicator: 'green',
							message: r.message.message
						});
						frm.reload_doc();
					} else {
						frappe.msgprint({
							title: __('Error'),
							indicator: 'red',
							message: r.message ? r.message.message : __('Sync failed')
						});
					}
				}
			});
		}, __('Actions'));

		// Full Sync button (all pages)
		frm.add_custom_button(__('Alle synchronisieren'), function() {
			frappe.confirm(
				__('Alle Fahrten und Ladesitzungen synchronisieren? Das kann bei vielen Einträgen etwas dauern.'),
				function() {
					frappe.call({
						method: 'yeshugo_erpnext.yeshugo_erpnext.doctype.yeshugo_settings.yeshugo_api.sync_yeshugo_data_full',
						freeze: true,
						freeze_message: __('Synchronisiere alle Daten...'),
						callback: function(r) {
							if (r.message && r.message.success) {
								frappe.msgprint({
									title: __('Erfolg'),
									indicator: 'green',
									message: r.message.message
								});
								frm.reload_doc();
							} else {
								frappe.msgprint({
									title: __('Fehler'),
									indicator: 'red',
									message: r.message ? r.message.message : __('Sync fehlgeschlagen')
								});
							}
						}
					});
				}
			);
		}, __('Actions'));

		// Set Home Location button
		frm.add_custom_button(__('Set Current Location as Home'), function() {
			frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.doctype.yeshugo_settings.yeshugo_api.get_current_vehicle_location',
				freeze: true,
				freeze_message: __('Getting current location...'),
				callback: function(r) {
					if (r.message && r.message.success) {
						frm.set_value('home_latitude', r.message.latitude);
						frm.set_value('home_longitude', r.message.longitude);
						frm.save();
						frappe.msgprint({
							title: __('Success'),
							indicator: 'green',
							message: __('Home location set to current vehicle position')
						});
					} else {
						frappe.msgprint({
							title: __('Error'),
							indicator: 'red',
							message: r.message ? r.message.message : __('Could not get location')
						});
					}
				}
			});
		}, __('Actions'));
	}
});
