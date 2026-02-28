frappe.pages['yeshugo-trips'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('YesHugo Trips'),
		single_column: true
	});

	new YesHugoTripsPage(page);
};

class YesHugoTripsPage {
	constructor(page) {
		this.page = page;
		this.settings = null;
		this.activity_types = [];
		this.current_employee = null;
		this.ready = false;
		this.make_filters();
		this.make_content();
		this.bind_week_navigation();
		this.load_initial_data().then(() => {
			this.update_week_label();
			this.ready = true;
			this.refresh();
		});
	}

	async load_initial_data() {
		await Promise.all([
			this.load_settings(),
			this.load_activity_types(),
			this.load_current_employee()
		]);
	}

	get_week_range(date) {
		// Get Monday-Sunday range for the week containing the given date
		const d = frappe.datetime.str_to_obj(date || frappe.datetime.get_today());
		const day = d.getDay(); // 0=Sun, 1=Mon, ...
		const diffToMonday = day === 0 ? -6 : 1 - day;
		const monday = frappe.datetime.add_days(frappe.datetime.obj_to_str(d), diffToMonday);
		const sunday = frappe.datetime.add_days(monday, 6);
		return { from_date: monday, to_date: sunday };
	}

	set_week(date) {
		const range = this.get_week_range(date);
		this.from_date_field.set_value(range.from_date);
		this.to_date_field.set_value(range.to_date);
		this.update_week_label();
		this.refresh_data();
	}

	update_week_label() {
		const from = this.from_date_field.get_value();
		const to = this.to_date_field.get_value();
		if (!from || !to) return;
		const fromDate = frappe.datetime.str_to_obj(from);
		const toDate = frappe.datetime.str_to_obj(to);

		// Get ISO week number
		const d = new Date(fromDate);
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
		const week1 = new Date(d.getFullYear(), 0, 4);
		const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);

		const label = `KW ${weekNum}: ${fromDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} - ${toDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
		this.page.main.find('.week-label').text(label);
	}

	make_filters() {
		// Vehicle Filter
		this.vehicle_field = this.page.add_field({
			fieldname: 'vehicle',
			label: __('Fahrzeug'),
			fieldtype: 'Link',
			options: 'YesHugo Vehicle',
			change: () => this.refresh_data()
		});

		// Date Range - current week (Monday to Sunday)
		const week = this.get_week_range();

		this.from_date_field = this.page.add_field({
			fieldname: 'from_date',
			label: __('Von'),
			fieldtype: 'Date',
			default: week.from_date,
			change: () => {
				this.update_week_label();
				this.refresh_data();
			}
		});

		// Date Range - To
		this.to_date_field = this.page.add_field({
			fieldname: 'to_date',
			label: __('Bis'),
			fieldtype: 'Date',
			default: week.to_date,
			change: () => {
				this.update_week_label();
				this.refresh_data();
			}
		});

		// View Mode
		this.view_mode_field = this.page.add_field({
			fieldname: 'view_mode',
			label: __('Ansicht'),
			fieldtype: 'Select',
			options: [
				{ label: __('Detailansicht'), value: 'detail' },
				{ label: __('Tagesübersicht'), value: 'summary' }
			],
			default: 'detail',
			change: () => this.refresh_data()
		});

		// Hide Billed Filter
		this.hide_billed_field = this.page.add_field({
			fieldname: 'hide_billed',
			label: __('Abgerechnete ausblenden'),
			fieldtype: 'Check',
			default: 0,
			change: () => this.refresh_data()
		});

		// Refresh Button - syncs from YesHugo API first, then refreshes display
		this.page.set_primary_action(__('Aktualisieren'), () => this.sync_and_refresh(), 'refresh');
	}

	async sync_and_refresh() {
		// Show loading indicator
		const container = this.page.main.find('.trips-data-container');
		container.html(`<div class="loading-indicator"><i class="fa fa-spinner fa-spin"></i> ${__('Synchronisiere mit YesHugo...')}</div>`);

		try {
			// First sync from YesHugo API
			const syncResult = await frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.doctype.yeshugo_settings.yeshugo_api.sync_yeshugo_data'
			});

			if (syncResult.message && syncResult.message.success) {
				frappe.show_alert({
					message: syncResult.message.message || __('Synchronisierung erfolgreich'),
					indicator: 'green'
				});
			}
		} catch (error) {
			console.error('Sync error:', error);
			frappe.show_alert({
				message: __('Synchronisierung fehlgeschlagen, zeige lokale Daten'),
				indicator: 'orange'
			});
		}

		// Then refresh the display
		await this.refresh();
	}

	make_content() {
		this.page.main.html(`
			<div class="yeshugo-trips-container">
				<!-- Settings Info -->
				<div class="settings-info-container mb-4">
					<div class="alert alert-info">
						<i class="fa fa-home"></i>
						<span class="home-info">${__('Lade Einstellungen...')}</span>
					</div>
				</div>

				<!-- Employee Info -->
				<div class="employee-info-container mb-4" style="display: none;">
					<div class="alert alert-warning">
						<i class="fa fa-user"></i>
						<span class="employee-info"></span>
					</div>
				</div>

				<!-- Week Navigation -->
				<div class="week-navigation mb-4">
					<button class="btn btn-default btn-sm btn-prev-week">
						<i class="fa fa-chevron-left"></i> ${__('Vorherige Woche')}
					</button>
					<span class="week-label"></span>
					<button class="btn btn-default btn-sm btn-next-week">
						${__('Nächste Woche')} <i class="fa fa-chevron-right"></i>
					</button>
					<button class="btn btn-default btn-sm btn-current-week" title="${__('Aktuelle Woche')}">
						<i class="fa fa-dot-circle-o"></i> ${__('Heute')}
					</button>
				</div>

				<!-- Summary Cards -->
				<div class="summary-cards-container mb-4">
					<div class="row">
						<div class="col-md-3">
							<div class="summary-card">
								<div class="summary-icon"><i class="fa fa-road"></i></div>
								<div class="summary-content">
									<div class="summary-value total-trips">-</div>
									<div class="summary-label">${__('Fahrten')}</div>
								</div>
							</div>
						</div>
						<div class="col-md-3">
							<div class="summary-card">
								<div class="summary-icon"><i class="fa fa-tachometer"></i></div>
								<div class="summary-content">
									<div class="summary-value total-distance">-</div>
									<div class="summary-label">${__('Kilometer gesamt')}</div>
									<div class="summary-breakdown">
										<span class="km-business"><i class="fa fa-briefcase"></i> -</span>
										<span class="km-private"><i class="fa fa-user"></i> -</span>
									</div>
								</div>
							</div>
						</div>
						<div class="col-md-3">
							<div class="summary-card">
								<div class="summary-icon"><i class="fa fa-clock-o"></i></div>
								<div class="summary-content">
									<div class="summary-value total-driving-time">-</div>
									<div class="summary-label">${__('Fahrzeit')}</div>
								</div>
							</div>
						</div>
						<div class="col-md-3">
							<div class="summary-card highlight">
								<div class="summary-icon"><i class="fa fa-map-marker"></i></div>
								<div class="summary-content">
									<div class="summary-value total-stop-time">-</div>
									<div class="summary-label">${__('Stopps auswärts')}</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Main Data Container -->
				<div class="trips-data-container">
					<div class="loading-indicator">${__('Lade Daten...')}</div>
				</div>
			</div>

			<style>
				.yeshugo-trips-container {
					padding: 15px;
				}
				.week-navigation {
					display: flex;
					align-items: center;
					gap: 12px;
					flex-wrap: wrap;
				}
				.week-label {
					font-weight: 600;
					font-size: 15px;
					min-width: 220px;
					text-align: center;
				}
				.settings-info-container .alert,
				.employee-info-container .alert {
					display: flex;
					align-items: center;
					gap: 10px;
					margin-bottom: 0;
				}
				.summary-cards-container .row {
					display: flex;
					flex-wrap: wrap;
				}
				.summary-card {
					display: flex;
					align-items: center;
					padding: 15px;
					background: var(--card-bg);
					border: 1px solid var(--border-color);
					border-radius: 8px;
					margin-bottom: 10px;
				}
				.summary-card.highlight {
					border-left: 4px solid var(--primary);
					background: var(--subtle-fg);
				}
				.summary-icon {
					font-size: 24px;
					color: var(--text-muted);
					margin-right: 15px;
				}
				.summary-card.highlight .summary-icon {
					color: var(--primary);
				}
				.summary-value {
					font-size: 20px;
					font-weight: 600;
				}
				.summary-label {
					font-size: 12px;
					color: var(--text-muted);
				}
				.summary-breakdown {
					display: flex;
					gap: 12px;
					margin-top: 4px;
					font-size: 12px;
				}
				.summary-breakdown .km-business {
					color: #28a745;
				}
				.summary-breakdown .km-private {
					color: #9b59b6;
				}
				.summary-breakdown i {
					margin-right: 3px;
				}
				.loading-indicator {
					padding: 40px;
					text-align: center;
					color: var(--text-muted);
				}
				.day-card {
					background: var(--card-bg);
					border: 1px solid var(--border-color);
					border-radius: 8px;
					margin-bottom: 20px;
					overflow: hidden;
				}
				.day-header {
					background: var(--subtle-fg);
					padding: 12px 15px;
					border-bottom: 1px solid var(--border-color);
					display: flex;
					justify-content: space-between;
					align-items: center;
				}
				.day-date {
					font-weight: 600;
					font-size: 16px;
				}
				.day-stats {
					display: flex;
					gap: 20px;
					font-size: 13px;
					color: var(--text-muted);
				}
				.day-stat {
					display: flex;
					align-items: center;
					gap: 5px;
				}
				.day-stat.highlight {
					color: var(--primary);
					font-weight: 500;
				}
				.vehicle-section {
					padding: 15px;
					border-bottom: 1px solid var(--border-color);
				}
				.vehicle-section:last-child {
					border-bottom: none;
				}
				.vehicle-header {
					display: flex;
					align-items: center;
					gap: 10px;
					margin-bottom: 15px;
					padding-bottom: 10px;
					border-bottom: 1px dashed var(--border-color);
				}
				.vehicle-plate {
					font-weight: 600;
					font-size: 14px;
					background: var(--primary);
					color: white;
					padding: 3px 8px;
					border-radius: 4px;
				}
				.vehicle-stats {
					font-size: 12px;
					color: var(--text-muted);
					display: flex;
					gap: 15px;
				}
				.trips-timeline {
					position: relative;
					padding-left: 30px;
				}
				.trips-timeline::before {
					content: '';
					position: absolute;
					left: 10px;
					top: 0;
					bottom: 0;
					width: 2px;
					background: var(--border-color);
				}
				.timeline-item {
					position: relative;
					padding: 10px 0;
				}
				.timeline-item::before {
					content: '';
					position: absolute;
					left: -24px;
					top: 15px;
					width: 10px;
					height: 10px;
					border-radius: 50%;
					background: var(--primary);
					border: 2px solid var(--card-bg);
				}
				.timeline-item.private::before {
					background: #9b59b6;
				}
				.timeline-item.stop::before {
					background: #ffc107;
				}
				.timeline-item.stop-home::before {
					background: #28a745;
				}
				.trip-card {
					background: var(--subtle-fg);
					border-radius: 6px;
					padding: 12px;
				}
				.trip-card.private {
					background: rgba(155, 89, 182, 0.1);
					border-left: 3px solid #9b59b6;
				}
				.trip-details {
					display: flex;
					align-items: center;
					gap: 8px;
					margin-top: 8px;
				}
				.reason-badge {
					display: inline-block;
					padding: 2px 8px;
					border-radius: 3px;
					font-size: 11px;
					font-weight: 500;
				}
				.reason-badge.business {
					background: rgba(46, 125, 50, 0.15);
					color: #2e7d32;
				}
				.reason-badge.private {
					background: rgba(155, 89, 182, 0.15);
					color: #9b59b6;
				}
				.reason-badge.commute {
					background: rgba(255, 152, 0, 0.15);
					color: #f57c00;
				}
				.btn-show-map {
					background: none;
					border: 1px solid var(--border-color);
					border-radius: 4px;
					padding: 2px 6px;
					cursor: pointer;
					color: var(--text-muted);
					font-size: 12px;
				}
				.btn-show-map:hover {
					background: var(--subtle-fg);
					color: var(--primary);
				}
				.map-popup {
					position: fixed;
					top: 0;
					left: 0;
					right: 0;
					bottom: 0;
					background: rgba(0,0,0,0.5);
					display: flex;
					align-items: center;
					justify-content: center;
					z-index: 1050;
				}
				.map-popup-content {
					background: var(--card-bg);
					border-radius: 8px;
					padding: 15px;
					width: 90%;
					max-width: 600px;
					max-height: 80vh;
				}
				.map-popup-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					margin-bottom: 10px;
				}
				.map-popup-close {
					background: none;
					border: none;
					font-size: 20px;
					cursor: pointer;
					color: var(--text-muted);
				}
				.map-container {
					height: 400px;
					border-radius: 4px;
					overflow: hidden;
				}
				.trip-header {
					display: flex;
					justify-content: space-between;
					align-items: flex-start;
					margin-bottom: 8px;
				}
				.trip-time {
					font-weight: 500;
				}
				.trip-duration {
					font-size: 12px;
					color: var(--text-muted);
				}
				.trip-distance {
					font-weight: 600;
					color: var(--primary);
				}
				.trip-route {
					font-size: 12px;
					color: var(--text-muted);
				}
				.trip-route .fa {
					margin: 0 5px;
				}
				.location-badge {
					display: inline-block;
					padding: 2px 6px;
					border-radius: 3px;
					font-size: 11px;
					margin-left: 5px;
				}
				.location-badge.home {
					background: rgba(40, 167, 69, 0.15);
					color: #28a745;
				}
				.location-badge.away {
					background: rgba(255, 199, 7, 0.15);
					color: #856404;
				}
				.stop-card {
					background: rgba(255, 193, 7, 0.08);
					border: 1px solid rgba(255, 193, 7, 0.3);
					border-left: 4px solid #ffc107;
					border-radius: 8px;
					padding: 16px;
					box-shadow: 0 2px 8px rgba(0,0,0,0.04);
				}
				.stop-card.at-home {
					background: rgba(40, 167, 69, 0.08);
					border-color: rgba(40, 167, 69, 0.3);
					border-left-color: #28a745;
				}
				.stop-card.transferred {
					background: rgba(40, 167, 69, 0.08);
					border-color: rgba(40, 167, 69, 0.3);
					border-left-color: #28a745;
				}
				/* Charging stop styles */
				.timeline-item.charging::before {
					background: #17a2b8;
				}
				.stop-card.charging {
					background: rgba(23, 162, 184, 0.08);
					border-color: rgba(23, 162, 184, 0.3);
					border-left-color: #17a2b8;
				}
				.stop-card.charging .stop-label {
					color: #17a2b8;
				}
				.stop-card.charging .stop-duration {
					color: #17a2b8;
				}
				.charging-info {
					display: flex;
					gap: 24px;
					flex-wrap: wrap;
					padding: 12px 16px;
					background: rgba(23, 162, 184, 0.05);
					border-radius: 6px;
					margin-bottom: 12px;
				}
				.charging-stat {
					display: flex;
					align-items: center;
					gap: 8px;
				}
				.charging-stat i {
					color: #17a2b8;
					font-size: 14px;
				}
				.charging-value {
					font-weight: 600;
					color: var(--text-color);
				}
				.charging-label {
					color: var(--text-muted);
					font-size: 12px;
				}
				.stop-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					margin-bottom: 12px;
					padding-bottom: 12px;
					border-bottom: 1px solid var(--border-color);
				}
				.stop-label {
					font-size: 13px;
					font-weight: 600;
					color: #856404;
					display: flex;
					align-items: center;
					gap: 6px;
				}
				.stop-card.at-home .stop-label,
				.stop-card.transferred .stop-label {
					color: #28a745;
				}
				.stop-duration {
					font-weight: 700;
					font-size: 16px;
					color: #856404;
				}
				.stop-card.at-home .stop-duration,
				.stop-card.transferred .stop-duration {
					color: #28a745;
				}
				.stop-location {
					font-size: 12px;
					color: var(--text-muted);
					margin-bottom: 16px;
					display: flex;
					align-items: center;
					gap: 8px;
				}
				.stop-location i {
					color: var(--text-light);
				}
				/* Two Column Layout for Stop */
				.stop-content {
					display: grid;
					grid-template-columns: 1fr 350px;
					gap: 20px;
					align-items: start;
				}
				@media (max-width: 992px) {
					.stop-content {
						grid-template-columns: 1fr;
					}
					.stop-map-container {
						order: -1;
					}
				}
				.stop-map-container {
					height: 280px;
					border-radius: 8px;
					overflow: hidden;
					border: 1px solid var(--border-color);
					background: var(--subtle-fg);
				}
				.stop-map-container iframe {
					width: 100%;
					height: 100%;
					border: none;
				}
				/* Timesheet Form Styles - Modernized */
				.timesheet-form {
					display: flex;
					flex-direction: column;
					gap: 16px;
				}
				.timesheet-form .form-row {
					display: grid;
					grid-template-columns: 1fr 1fr;
					gap: 16px;
				}
				@media (max-width: 768px) {
					.timesheet-form .form-row {
						grid-template-columns: 1fr;
					}
				}
				.timesheet-form .form-group {
					display: flex;
					flex-direction: column;
				}
				.timesheet-form .form-group.full-width {
					grid-column: 1 / -1;
				}
				.timesheet-form label {
					display: block;
					font-size: 12px;
					font-weight: 600;
					color: var(--text-color);
					margin-bottom: 6px;
					text-transform: uppercase;
					letter-spacing: 0.3px;
				}
				.timesheet-form label .required {
					color: #e74c3c;
					margin-left: 2px;
				}
				.timesheet-form input,
				.timesheet-form select,
				.timesheet-form textarea {
					width: 100%;
					padding: 10px 12px;
					border: 1px solid var(--border-color);
					border-radius: 6px;
					font-size: 14px;
					background: var(--control-bg);
					transition: all 0.2s ease;
				}
				.timesheet-form input:hover,
				.timesheet-form select:hover,
				.timesheet-form textarea:hover {
					border-color: var(--gray-400);
				}
				.timesheet-form input:focus,
				.timesheet-form select:focus,
				.timesheet-form textarea:focus {
					border-color: var(--primary);
					outline: none;
					box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.15);
					background: var(--card-bg);
				}
				.timesheet-form textarea {
					min-height: 70px;
					resize: vertical;
				}
				.timesheet-form .duration-input-wrapper {
					position: relative;
				}
				.timesheet-form .duration-input-wrapper input {
					padding-right: 50px;
				}
				.timesheet-form .duration-hint {
					position: absolute;
					right: 10px;
					top: 50%;
					transform: translateY(-50%);
					font-size: 11px;
					color: var(--text-muted);
					pointer-events: none;
				}
				.timesheet-form .form-footer {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding-top: 16px;
					margin-top: 8px;
				}
				.timesheet-form .time-info {
					font-size: 13px;
					color: var(--text-muted);
					display: flex;
					align-items: center;
					gap: 6px;
				}
				.timesheet-form .time-info strong {
					color: var(--text-color);
					font-weight: 600;
				}
				.timesheet-form .btn-transfer {
					display: inline-flex;
					align-items: center;
					gap: 8px;
					padding: 12px 20px;
					font-size: 14px;
					font-weight: 600;
					border-radius: 6px;
					cursor: pointer;
					background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark, var(--primary)) 100%);
					color: white;
					border: none;
					transition: all 0.2s ease;
					box-shadow: 0 2px 4px rgba(0,0,0,0.1);
				}
				.timesheet-form .btn-transfer:hover {
					transform: translateY(-1px);
					box-shadow: 0 4px 8px rgba(0,0,0,0.15);
				}
				.timesheet-form .btn-transfer:active {
					transform: translateY(0);
				}
				.timesheet-form .btn-transfer:disabled {
					background: var(--gray-400);
					cursor: not-allowed;
					transform: none;
					box-shadow: none;
				}
				/* Inline fields row */
				.timesheet-form .form-row-inline {
					display: flex;
					gap: 16px;
				}
				.timesheet-form .form-row-inline .form-group {
					flex: 1;
				}
				.timesheet-form .form-row-inline .form-group.narrow {
					flex: 0 0 120px;
				}
				.transfer-success {
					display: flex;
					align-items: center;
					gap: 10px;
					padding: 10px 14px;
					background: rgba(40, 167, 69, 0.1);
					border-radius: 6px;
					color: #28a745;
					font-size: 13px;
					margin-top: 12px;
				}
				.transfer-success i {
					font-size: 16px;
				}
				.transfer-success a {
					color: #28a745;
					font-weight: 500;
					text-decoration: underline;
				}
				.billed-info {
					display: flex;
					align-items: center;
					gap: 8px;
					margin-top: 10px;
					padding: 8px 12px;
					background: rgba(40, 167, 69, 0.1);
					border-radius: 4px;
					font-size: 12px;
					color: #28a745;
				}
				.billed-info a {
					color: #28a745;
					font-weight: 500;
				}
				.empty-state {
					padding: 60px 20px;
					text-align: center;
					color: var(--text-muted);
				}
				.empty-state i {
					font-size: 48px;
					margin-bottom: 15px;
					opacity: 0.5;
				}
				/* Summary View Styles */
				.summary-table {
					width: 100%;
					border-collapse: collapse;
				}
				.summary-table th,
				.summary-table td {
					padding: 12px;
					border: 1px solid var(--border-color);
					text-align: left;
				}
				.summary-table th {
					background: var(--subtle-fg);
					font-weight: 600;
				}
				.summary-table tr:hover {
					background: var(--subtle-fg);
				}
				.text-right {
					text-align: right;
				}
				/* Link field styling */
				.link-field-wrapper {
					position: relative;
				}
				.link-field-wrapper .awesomplete {
					width: 100%;
				}
				.link-field-wrapper input {
					width: 100%;
				}
				.link-field-wrapper .frappe-control {
					margin: 0;
				}
				.link-field-wrapper .frappe-control .form-group {
					margin: 0;
				}
				/* Trip Type Buttons */
				.trip-type-buttons {
					display: flex;
					gap: 6px;
					flex-wrap: wrap;
				}
				.btn-trip-type {
					display: inline-flex;
					align-items: center;
					gap: 4px;
					padding: 4px 10px;
					border-radius: 4px;
					font-size: 11px;
					font-weight: 500;
					cursor: pointer;
					transition: all 0.2s ease;
					border: 2px solid;
				}
				/* Commute - Yellow */
				.btn-trip-type.commute {
					background: rgba(255, 193, 7, 0.1);
					border-color: rgba(255, 193, 7, 0.3);
					color: #856404;
				}
				.btn-trip-type.commute:hover {
					background: rgba(255, 193, 7, 0.2);
					border-color: rgba(255, 193, 7, 0.5);
				}
				.btn-trip-type.commute.active {
					background: #ffc107;
					border-color: #ffc107;
					color: #000;
				}
				/* Private - Purple */
				.btn-trip-type.private {
					background: rgba(155, 89, 182, 0.1);
					border-color: rgba(155, 89, 182, 0.3);
					color: #9b59b6;
				}
				.btn-trip-type.private:hover {
					background: rgba(155, 89, 182, 0.2);
					border-color: rgba(155, 89, 182, 0.5);
				}
				.btn-trip-type.private.active {
					background: #9b59b6;
					border-color: #9b59b6;
					color: #fff;
				}
				/* Business - Green */
				.btn-trip-type.business {
					background: rgba(40, 167, 69, 0.1);
					border-color: rgba(40, 167, 69, 0.3);
					color: #28a745;
				}
				.btn-trip-type.business:hover {
					background: rgba(40, 167, 69, 0.2);
					border-color: rgba(40, 167, 69, 0.5);
				}
				.btn-trip-type.business.active {
					background: #28a745;
					border-color: #28a745;
					color: #fff;
				}
				.btn-trip-type:disabled {
					opacity: 0.5;
					cursor: not-allowed;
				}
				/* Trip Ignore Checkbox */
				.trip-ignore-option {
					margin-top: 10px;
					padding-top: 10px;
					border-top: 1px dashed var(--border-color);
				}
				.trip-ignore-label {
					display: flex;
					align-items: center;
					gap: 8px;
					cursor: pointer;
					font-size: 12px;
					color: var(--text-muted);
					margin: 0;
				}
				.trip-ignore-label:hover {
					color: var(--primary);
				}
				.trip-ignore-checkbox {
					width: 16px;
					height: 16px;
					cursor: pointer;
				}
				.trip-ignore-checkbox:checked + i {
					color: var(--primary);
				}
				.trip-ignore-option.active {
					background: rgba(var(--primary-rgb), 0.1);
					border-radius: 4px;
					padding: 8px;
					margin-top: 8px;
					border-top: none;
				}
				.trip-ignore-option.active .trip-ignore-label {
					color: var(--primary);
					font-weight: 500;
				}
				/* Hidden stop (when trip is ignored) */
				.timeline-item.stop.hidden-by-ignore {
					display: none;
				}
				/* Linked stops info in main stop */
				.linked-stops-info {
					background: rgba(var(--primary-rgb), 0.08);
					border: 1px solid rgba(var(--primary-rgb), 0.2);
					border-radius: 6px;
					padding: 10px 12px;
					margin-bottom: 12px;
					font-size: 12px;
				}
				.linked-stops-info .linked-stops-header {
					display: flex;
					align-items: center;
					gap: 6px;
					font-weight: 600;
					color: var(--primary);
					margin-bottom: 4px;
				}
				.linked-stops-info .linked-stops-total {
					color: var(--text-muted);
				}
				.linked-stops-info .linked-stops-driving {
					margin-top: 6px;
					padding-top: 6px;
					border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
				}
				.linked-stops-info .linked-stops-driving a {
					color: var(--primary);
					text-decoration: none;
					cursor: pointer;
				}
				.linked-stops-info .linked-stops-driving a:hover {
					text-decoration: underline;
				}
				.linked-stops-info .linked-stops-driving.included {
					color: #28a745;
				}
				.linked-stops-info .linked-stops-driving.included a {
					color: var(--text-muted);
					font-size: 11px;
					margin-left: 8px;
				}
				/* Trip Comment Section */
				.trip-comment-section {
					margin-top: 10px;
					padding-top: 10px;
					border-top: 1px dashed var(--border-color);
				}
				.comment-input-row {
					display: flex;
					gap: 8px;
					align-items: center;
				}
				.trip-comment-input {
					flex: 1;
					padding: 6px 10px;
					border: 1px solid var(--border-color);
					border-radius: 4px;
					font-size: 12px;
					background: var(--control-bg);
					color: var(--text-color);
				}
				.trip-comment-input:not([readonly]) {
					background: var(--card-bg);
					border-color: var(--primary);
				}
				.trip-comment-input:focus {
					outline: none;
					border-color: var(--primary);
				}
				.btn-update-comment {
					padding: 6px 10px;
					border: 1px solid var(--border-color);
					border-radius: 4px;
					background: var(--control-bg);
					color: var(--text-muted);
					cursor: pointer;
					transition: all 0.2s;
				}
				.btn-update-comment:hover {
					background: var(--primary);
					color: white;
					border-color: var(--primary);
				}
				.btn-update-comment.editing {
					background: var(--primary);
					color: white;
					border-color: var(--primary);
				}
				.btn-update-comment.saving {
					opacity: 0.7;
					cursor: wait;
				}
				.btn-copy-last-comment {
					display: inline-flex;
					align-items: center;
					gap: 3px;
					padding: 6px 10px;
					border: 1px solid var(--border-color);
					border-radius: 4px;
					background: var(--control-bg);
					color: var(--text-muted);
					cursor: pointer;
					transition: all 0.2s;
					font-size: 12px;
				}
				.btn-copy-last-comment:hover {
					background: #ffc107;
					color: #000;
					border-color: #ffc107;
				}
				/* Stop Tabs */
				.stop-shared-fields {
					margin-bottom: 12px;
				}
				.stop-shared-fields .form-row {
					display: grid;
					grid-template-columns: 1fr 1fr;
					gap: 16px;
				}
				.stop-shared-fields .form-group {
					display: flex;
					flex-direction: column;
				}
				.stop-shared-fields label {
					display: block;
					font-size: 12px;
					font-weight: 600;
					color: var(--text-color);
					margin-bottom: 6px;
					text-transform: uppercase;
					letter-spacing: 0.3px;
				}
				.stop-shared-fields label .required {
					color: #e74c3c;
					margin-left: 2px;
				}
				.stop-tabs {
					display: flex;
					gap: 0;
					border-bottom: 2px solid var(--border-color);
					margin-bottom: 16px;
				}
				.stop-tab {
					padding: 8px 16px;
					border: none;
					background: none;
					color: var(--text-muted);
					font-size: 13px;
					font-weight: 600;
					cursor: pointer;
					border-bottom: 2px solid transparent;
					margin-bottom: -2px;
					transition: all 0.2s;
					display: flex;
					align-items: center;
					gap: 6px;
				}
				.stop-tab:hover {
					color: var(--text-color);
				}
				.stop-tab.active {
					color: var(--primary);
					border-bottom-color: var(--primary);
				}
				.stop-tab-panel {
					display: none;
				}
				.stop-tab-panel.active {
					display: block;
				}
				/* Delivery Note Form */
				.dn-items-container {
					display: flex;
					flex-direction: column;
					gap: 8px;
				}
				.dn-item-row {
					display: flex;
					gap: 12px;
					align-items: flex-end;
				}
				.dn-item-row .form-group label {
					display: block;
					font-size: 12px;
					font-weight: 600;
					color: var(--text-color);
					margin-bottom: 6px;
					text-transform: uppercase;
					letter-spacing: 0.3px;
				}
				.dn-item-row .form-group label .required {
					color: #e74c3c;
					margin-left: 2px;
				}
				.dn-item-qty {
					width: 100%;
					padding: 10px 12px;
					border: 1px solid var(--border-color);
					border-radius: 6px;
					font-size: 14px;
					background: var(--control-bg);
				}
				.dn-item-qty:focus {
					border-color: var(--primary);
					outline: none;
					box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.15);
				}
				.btn-remove-dn-item {
					padding: 10px;
					border: 1px solid var(--border-color);
					border-radius: 6px;
					background: none;
					color: var(--text-muted);
					cursor: pointer;
					flex-shrink: 0;
				}
				.btn-remove-dn-item:hover {
					background: #e74c3c;
					color: white;
					border-color: #e74c3c;
				}
				.btn-add-dn-item {
					margin-top: 8px;
					padding: 8px 14px;
					border: 1px dashed var(--border-color);
					border-radius: 6px;
					background: none;
					color: var(--text-muted);
					cursor: pointer;
					font-size: 12px;
					transition: all 0.2s;
				}
				.btn-add-dn-item:hover {
					border-color: var(--primary);
					color: var(--primary);
					background: rgba(var(--primary-rgb), 0.05);
				}
				.btn-create-dn {
					display: inline-flex;
					align-items: center;
					gap: 8px;
					padding: 12px 20px;
					font-size: 14px;
					font-weight: 600;
					border-radius: 6px;
					cursor: pointer;
					background: linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%);
					color: white;
					border: none;
					transition: all 0.2s ease;
					box-shadow: 0 2px 4px rgba(0,0,0,0.1);
				}
				.btn-create-dn:hover {
					transform: translateY(-1px);
					box-shadow: 0 4px 8px rgba(0,0,0,0.15);
				}
				.btn-create-dn:disabled {
					background: var(--gray-400);
					cursor: not-allowed;
					transform: none;
					box-shadow: none;
				}
				.dn-posting-date-label {
					display: flex !important;
					align-items: center;
					gap: 8px;
					text-transform: none !important;
					font-weight: 500 !important;
				}
				.dn-posting-date {
					width: 100%;
					padding: 10px 12px;
					border: 1px solid var(--border-color);
					border-radius: 6px;
					font-size: 14px;
					background: var(--control-bg);
					margin-top: 8px;
				}
				.dn-posting-date:focus {
					border-color: var(--primary);
					outline: none;
				}
				.dn-result .transfer-success {
					color: #2e7d32;
					background: rgba(46, 125, 50, 0.1);
				}
				.dn-result .transfer-success a {
					color: #2e7d32;
				}
				.comment-missing-indicator {
					display: inline-flex;
					align-items: center;
					justify-content: center;
					width: 22px;
					height: 22px;
					border-radius: 50%;
					background: #f90;
					color: #fff;
					font-size: 13px;
					font-weight: 700;
					cursor: help;
					flex-shrink: 0;
				}
			</style>
		`);
	}

	bind_week_navigation() {
		this.page.main.find('.btn-prev-week').on('click', () => {
			const from = this.from_date_field.get_value();
			const prevWeek = frappe.datetime.add_days(from, -7);
			this.set_week(prevWeek);
		});

		this.page.main.find('.btn-next-week').on('click', () => {
			const from = this.from_date_field.get_value();
			const nextWeek = frappe.datetime.add_days(from, 7);
			this.set_week(nextWeek);
		});

		this.page.main.find('.btn-current-week').on('click', () => {
			this.set_week(frappe.datetime.get_today());
		});
	}

	async load_settings() {
		try {
			const result = await frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.get_settings'
			});
			this.settings = result.message;
			this.render_settings_info();
		} catch (error) {
			console.error('Error loading settings:', error);
		}
	}

	async load_activity_types() {
		try {
			const result = await frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.get_activity_types'
			});
			this.activity_types = result.message || [];
		} catch (error) {
			console.error('Error loading activity types:', error);
		}
	}

	async load_current_employee() {
		try {
			const result = await frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.get_current_employee'
			});
			this.current_employee = result.message;
			this.render_employee_info();
		} catch (error) {
			console.error('Error loading employee:', error);
		}
	}

	render_settings_info() {
		const container = this.page.main.find('.home-info');
		if (this.settings && this.settings.home_latitude && this.settings.home_longitude) {
			container.html(
				`${__('Home-Standort')}: ${this.settings.home_latitude.toFixed(4)}, ${this.settings.home_longitude.toFixed(4)} ` +
				`(${__('Radius')}: ${this.settings.home_radius}m) - ` +
				`<span class="text-muted">${__('Stopps innerhalb dieses Radius werden ausgeblendet')}</span>`
			);
		} else {
			container.html(
				`<span class="text-warning">${__('Kein Home-Standort konfiguriert. Bitte in den YesHugo Settings festlegen.')}</span>`
			);
		}
	}

	render_employee_info() {
		const container = this.page.main.find('.employee-info-container');
		const infoSpan = container.find('.employee-info');

		if (!this.current_employee) {
			container.show();
			infoSpan.html(
				`<span class="text-danger">${__('Kein Mitarbeiter-Datensatz gefunden. Timesheet-Übertragung nicht möglich.')}</span>`
			);
		} else {
			container.hide();
		}
	}

	async refresh() {
		await this.refresh_data();
	}

	async refresh_data() {
		if (!this.ready) return;
		const container = this.page.main.find('.trips-data-container');
		container.html(`<div class="loading-indicator"><i class="fa fa-spinner fa-spin"></i> ${__('Lade Daten...')}</div>`);

		try {
			const result = await frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.get_trips_overview',
				args: {
					vehicle: this.vehicle_field.get_value() || null,
					from_date: this.from_date_field.get_value() || null,
					to_date: this.to_date_field.get_value() || null
				}
			});

			const data = result.message;
			this.update_summary_cards(data);

			const viewMode = this.view_mode_field.get_value();
			if (viewMode === 'summary') {
				this.render_summary_view(data);
			} else {
				this.render_detail_view(data);
			}
		} catch (error) {
			console.error('Error loading trips:', error);
			container.html(`<div class="empty-state"><i class="fa fa-exclamation-circle"></i><br>${__('Fehler beim Laden der Daten')}</div>`);
		}
	}

	update_summary_cards(data) {
		let totalTrips = 0;
		let totalDistance = 0;
		let businessDistance = 0;
		let privateDistance = 0;
		let totalDrivingSeconds = 0;
		let totalStopSeconds = 0;

		for (const day of data.days || []) {
			for (const vehicle of day.vehicles || []) {
				totalTrips += vehicle.trips?.length || 0;
				totalDistance += vehicle.total_distance || 0;
				totalDrivingSeconds += vehicle.total_driving_time || 0;
				totalStopSeconds += vehicle.total_stop_time_outside || 0;

				// Calculate business vs private distance
				for (const trip of vehicle.trips || []) {
					const distance = trip.distance || 0;
					if (trip.reason === 'PRIVATE') {
						privateDistance += distance;
					} else {
						// BUSINESS and COMMUTE count as business
						businessDistance += distance;
					}
				}
			}
		}

		this.page.main.find('.total-trips').text(totalTrips);
		this.page.main.find('.total-distance').text(`${totalDistance.toFixed(1)} km`);
		this.page.main.find('.km-business').html(`<i class="fa fa-briefcase"></i> ${businessDistance.toFixed(1)} km`);
		this.page.main.find('.km-private').html(`<i class="fa fa-user"></i> ${privateDistance.toFixed(1)} km`);
		this.page.main.find('.total-driving-time').text(this.format_duration(totalDrivingSeconds));
		this.page.main.find('.total-stop-time').text(this.format_duration(totalStopSeconds));
	}

	format_duration(seconds) {
		if (!seconds || seconds < 0) return '-';

		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);

		if (hours > 0) {
			return `${hours}h ${minutes}m`;
		}
		return `${minutes}m`;
	}

	format_time(datetime) {
		if (!datetime) return '-';
		return frappe.datetime.str_to_user(datetime).split(' ')[1] || frappe.datetime.str_to_user(datetime);
	}

	seconds_to_duration_value(seconds) {
		// Convert seconds to hours with quarter precision (0.25, 0.5, 0.75, 1, etc.)
		const hours = seconds / 3600;
		// Always round UP to next quarter hour
		return Math.ceil(hours * 4) / 4;
	}

	format_hours_display(hours) {
		// Format hours as Xh Ym
		const h = Math.floor(hours);
		const m = Math.round((hours - h) * 60);
		if (h > 0 && m > 0) {
			return `${h}h ${m}m`;
		} else if (h > 0) {
			return `${h}h`;
		} else {
			return `${m}m`;
		}
	}

	format_date(dateStr) {
		if (!dateStr) return '-';
		const date = new Date(dateStr);
		const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
		return date.toLocaleDateString('de-DE', options);
	}

	show_map(lat, lon, address) {
		// Create map popup
		const popup = $(`
			<div class="map-popup">
				<div class="map-popup-content">
					<div class="map-popup-header">
						<div>
							<strong>${__('Zielort')}</strong>
							<div class="text-muted" style="font-size: 12px;">${address}</div>
						</div>
						<button class="map-popup-close">&times;</button>
					</div>
					<div class="map-container" id="trip-map"></div>
				</div>
			</div>
		`);

		$('body').append(popup);

		// Close handlers
		popup.find('.map-popup-close').on('click', () => popup.remove());
		popup.on('click', (e) => {
			if ($(e.target).hasClass('map-popup')) popup.remove();
		});

		// Initialize map with OpenStreetMap
		setTimeout(() => {
			if (typeof L !== 'undefined') {
				const map = L.map('trip-map').setView([lat, lon], 15);
				L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
					attribution: '© OpenStreetMap contributors'
				}).addTo(map);
				L.marker([lat, lon]).addTo(map)
					.bindPopup(address || `${lat}, ${lon}`)
					.openPopup();
			} else {
				// Fallback: Show OpenStreetMap in iframe
				$('#trip-map').html(`
					<iframe
						width="100%"
						height="100%"
						frameborder="0"
						scrolling="no"
						src="https://www.openstreetmap.org/export/embed.html?bbox=${lon-0.005},${lat-0.005},${lon+0.005},${lat+0.005}&layer=mapnik&marker=${lat},${lon}"
					></iframe>
				`);
			}
		}, 100);
	}

	generate_stop_id(stop) {
		// Generate unique ID for stop card
		return `stop-${stop.after_trip}-${stop.before_trip}`.replace(/[^a-zA-Z0-9-]/g, '_');
	}

	render_detail_view(data) {
		const container = this.page.main.find('.trips-data-container');

		if (!data.days || data.days.length === 0) {
			container.html(`
				<div class="empty-state">
					<i class="fa fa-car"></i>
					<h4>${__('Keine Fahrten gefunden')}</h4>
					<p>${__('Im ausgewählten Zeitraum wurden keine abgeschlossenen Fahrten gefunden.')}</p>
				</div>
			`);
			return;
		}

		// Build activity type options with default selected
		const defaultActivity = this.settings?.default_activity_type || '';
		const activityOptions = this.activity_types.map(at =>
			`<option value="${at.name}" ${at.name === defaultActivity ? 'selected' : ''}>${at.name}</option>`
		).join('');

		let html = '';
		let stopIndex = 0;

		for (const day of data.days) {
			// Calculate day totals
			let dayTrips = 0;
			let dayDistance = 0;
			let dayStopTime = 0;

			for (const v of day.vehicles) {
				dayTrips += v.trips.length;
				dayDistance += v.total_distance;
				dayStopTime += v.total_stop_time_outside;
			}

			html += `
				<div class="day-card">
					<div class="day-header">
						<div class="day-date">${this.format_date(day.date)}</div>
						<div class="day-stats">
							<div class="day-stat">
								<i class="fa fa-road"></i> ${dayTrips} ${__('Fahrten')}
							</div>
							<div class="day-stat">
								<i class="fa fa-tachometer"></i> ${dayDistance.toFixed(1)} km
							</div>
							<div class="day-stat highlight">
								<i class="fa fa-map-marker"></i> ${this.format_duration(dayStopTime)} ${__('auswärts')}
							</div>
						</div>
					</div>
			`;

			for (const vehicle of day.vehicles) {
				let vehicleStopCount = 0; // Track stops within this vehicle to know if we're at the first one
				let lastTripComment = ''; // Track last non-empty comment for copy button

				html += `
					<div class="vehicle-section">
						<div class="vehicle-header">
							<span class="vehicle-plate">${vehicle.license_plate || vehicle.vehicle_id}</span>
							<div class="vehicle-stats">
								<span><i class="fa fa-road"></i> ${vehicle.trips.length} ${__('Fahrten')}</span>
								<span><i class="fa fa-tachometer"></i> ${vehicle.total_distance} km</span>
								<span><i class="fa fa-clock-o"></i> ${vehicle.total_driving_time_formatted}</span>
								<span class="text-primary"><i class="fa fa-map-marker"></i> ${vehicle.total_stop_time_outside_formatted} ${__('auswärts')}</span>
							</div>
						</div>
						<div class="trips-timeline">
				`;

				// Render trips and stops in order
				for (let i = 0; i < vehicle.trips.length; i++) {
					const trip = vehicle.trips[i];

					// Check if this trip has a stop after it (in stops_outside_home)
					const tripStop = vehicle.stops_outside_home.find(s => s.after_trip === trip.name);
					const hasStopAfter = tripStop && !trip.billed;

					// Check if there are any future stops after this trip (for the ignore checkbox)
					// We need this because a trip might end at home (no stop) but still have future stops
					const futureStops = vehicle.stops_outside_home.filter(s => {
						const stopTripIndex = vehicle.trips.findIndex(t => t.name === s.after_trip);
						return stopTripIndex > i && !vehicle.trips[stopTripIndex]?.billed;
					});
					const hasFutureStops = futureStops.length > 0;

					// Render trip
					const isPrivate = trip.reason === 'PRIVATE';
					html += `
						<div class="timeline-item trip ${isPrivate ? 'private' : ''}" data-trip-name="${trip.name}">
							<div class="trip-card ${isPrivate ? 'private' : ''}">
								<div class="trip-header">
									<div>
										<div class="trip-time">
											${this.format_time(trip.start_time)} - ${this.format_time(trip.end_time)}
										</div>
										<div class="trip-duration">${trip.driving_time_formatted}</div>
									</div>
									<div class="trip-distance">${(trip.distance || 0).toFixed(1)} km</div>
								</div>
								<div class="trip-route">
									<span>${trip.start_address || __('Unbekannt')}</span>
									${trip.start_at_home ? `<span class="location-badge home"><i class="fa fa-home"></i></span>` : ''}
									<i class="fa fa-long-arrow-right"></i>
									<span>${trip.end_address || __('Unbekannt')}</span>
									${trip.end_at_home ? `<span class="location-badge home"><i class="fa fa-home"></i></span>` : ''}
								</div>
								<div class="trip-details">
									<div class="trip-type-buttons" data-trip-name="${trip.name}">
										<button class="btn-trip-type commute ${trip.reason === 'COMMUTE' ? 'active' : ''}" data-reason="COMMUTE" title="${__('Pendeln')}">
											<i class="fa fa-exchange"></i> ${__('Pendeln')}
										</button>
										<button class="btn-trip-type private ${trip.reason === 'PRIVATE' ? 'active' : ''}" data-reason="PRIVATE" title="${__('Privat')}">
											<i class="fa fa-user"></i> ${__('Privat')}
										</button>
										<button class="btn-trip-type business ${trip.reason === 'BUSINESS' ? 'active' : ''}" data-reason="BUSINESS" title="${__('Geschäftlich')}">
											<i class="fa fa-briefcase"></i> ${__('Geschäftlich')}
										</button>
									</div>
									${trip.end_latitude && trip.end_longitude ? `<button class="btn-show-map" data-lat="${trip.end_latitude}" data-lon="${trip.end_longitude}" data-address="${(trip.end_address || '').replace(/"/g, '&quot;')}" title="${__('Karte anzeigen')}"><i class="fa fa-map-marker"></i></button>` : ''}
								</div>
								${!isPrivate && vehicleStopCount > 0 && (hasStopAfter || hasFutureStops) ? `
								<div class="trip-ignore-option" data-trip-name="${trip.name}">
									<label class="trip-ignore-label">
										<input type="checkbox" class="trip-ignore-checkbox">
										<i class="fa fa-link"></i> ${__('Fahrt ignorieren (zur vorherigen Zeiterfassung)')}
									</label>
								</div>
								` : ''}
								<div class="trip-comment-section" data-trip-name="${trip.name}" data-external-id="${trip.external_id || ''}">
									<div class="comment-input-row">
										${!trip.comment && !isPrivate ? '<span class="comment-missing-indicator" title="' + __('Kommentar fehlt') + '">?</span>' : ''}
										<input type="text" class="trip-comment-input" value="${(trip.comment || '').replace(/"/g, '&quot;')}" placeholder="${__('Kommentar...')}" readonly>
										${lastTripComment ? `<button class="btn-copy-last-comment" title="${__('Kommentar von vorheriger Fahrt übernehmen')}">
											<i class="fa fa-arrow-up"></i><i class="fa fa-copy"></i>
										</button>` : ''}
										<button class="btn-update-comment" title="${__('Kommentar bearbeiten')}">
											<i class="fa fa-pencil"></i>
										</button>
									</div>
								</div>
							</div>
						</div>
					`;

					// Track immediate previous trip's comment for copy button
					// Reset each time so only the direct predecessor counts
					lastTripComment = (trip.comment && trip.comment.trim()) ? trip.comment.trim() : '';

					// Check if there's a stop after this trip (only for non-private trips)
					if (!isPrivate) {
						const stop = tripStop;
						if (stop) {
							// Check if trip is already billed
							const isBilled = trip.billed;
							const hideBilled = this.hide_billed_field.get_value();

							// Skip if billed and filter is active
							if (!(isBilled && hideBilled)) {
								const stopId = this.generate_stop_id(stop);
								const durationHours = this.seconds_to_duration_value(stop.duration_seconds);

								// Check if this is a charging stop
								if (stop.is_charging && stop.charge_session) {
									// Show charging stop
									const hasCoords = stop.latitude && stop.longitude;
									const mapUrl = hasCoords ? `https://www.openstreetmap.org/export/embed.html?bbox=${stop.longitude-0.003},${stop.latitude-0.003},${stop.longitude+0.003},${stop.latitude+0.003}&layer=mapnik&marker=${stop.latitude},${stop.longitude}` : '';
									const chargeSession = stop.charge_session;
									const chargedKwh = chargeSession.charged_kwh ? `${parseFloat(chargeSession.charged_kwh).toFixed(1)} kWh` : '-';
									const socInfo = (chargeSession.start_soc_percent !== null && chargeSession.end_soc_percent !== null)
										? `${chargeSession.start_soc_percent}% → ${chargeSession.end_soc_percent}%`
										: '';

									html += `
										<div class="timeline-item stop charging" id="${stopId}">
											<div class="stop-card charging" data-stop-id="${stopId}">
												<div class="stop-header">
													<span class="stop-label">
														<i class="fa fa-bolt"></i> ${__('Ladestopp')}
													</span>
													<span class="stop-duration">${stop.duration_formatted}</span>
												</div>
												<div class="stop-location">
													<i class="fa fa-clock-o"></i>
													${this.format_time(stop.start_time)} - ${this.format_time(stop.end_time)}
													<span style="margin: 0 8px;">|</span>
													<i class="fa fa-map-marker"></i>
													${stop.location}
												</div>
												<div class="stop-content">
													<div class="charging-info">
														<div class="charging-stat">
															<i class="fa fa-bolt"></i>
															<span class="charging-value">${chargedKwh}</span>
															<span class="charging-label">${__('geladen')}</span>
														</div>
														${socInfo ? `
														<div class="charging-stat">
															<i class="fa fa-battery-half"></i>
															<span class="charging-value">${socInfo}</span>
															<span class="charging-label">${__('Ladestand')}</span>
														</div>
														` : ''}
														${chargeSession.charge_type ? `
														<div class="charging-stat">
															<i class="fa fa-plug"></i>
															<span class="charging-value">${chargeSession.charge_type}</span>
														</div>
														` : ''}
													</div>
													${hasCoords ? `
													<div class="stop-map-container" style="height: 150px;">
														<iframe src="${mapUrl}" loading="lazy"></iframe>
													</div>
													` : ''}
												</div>
											</div>
										</div>
									`;
								} else if (isBilled) {
									// Show billed status with link to timesheet and map
									const hasCoords = stop.latitude && stop.longitude;
									const mapUrl = hasCoords ? `https://www.openstreetmap.org/export/embed.html?bbox=${stop.longitude-0.003},${stop.latitude-0.003},${stop.longitude+0.003},${stop.latitude+0.003}&layer=mapnik&marker=${stop.latitude},${stop.longitude}` : '';

									html += `
										<div class="timeline-item stop" id="${stopId}">
											<div class="stop-card transferred" data-stop-id="${stopId}">
												<div class="stop-header">
													<span class="stop-label">
														<i class="fa fa-check-circle"></i> ${__('Abgerechnet')}
													</span>
													<span class="stop-duration">${stop.duration_formatted}</span>
												</div>
												<div class="stop-location">
													<i class="fa fa-clock-o"></i>
													${this.format_time(stop.start_time)} - ${this.format_time(stop.end_time)}
													<span style="margin: 0 8px;">|</span>
													<i class="fa fa-map-marker"></i>
													${stop.location}
												</div>
												<div class="stop-content">
													${trip.timesheet ? `<div class="billed-info" style="margin: 0;">
														<i class="fa fa-file-text-o"></i>
														<a href="/app/timesheet/${trip.timesheet}" target="_blank">${trip.timesheet}</a>
													</div>` : ''}
													${trip.delivery_note ? `<div class="billed-info" style="margin: ${trip.timesheet ? '6px' : '0'} 0 0 0;">
														<i class="fa fa-truck"></i>
														<a href="/app/delivery-note/${trip.delivery_note}" target="_blank">${trip.delivery_note}</a>
													</div>` : ''}
													${hasCoords ? `
													<div class="stop-map-container" style="height: 150px;">
														<iframe src="${mapUrl}" loading="lazy"></iframe>
													</div>
													` : ''}
												</div>
											</div>
										</div>
									`;
								} else {
									// Show transfer form with map
									const hasCoords = stop.latitude && stop.longitude;
									const mapUrl = hasCoords ? `https://www.openstreetmap.org/export/embed.html?bbox=${stop.longitude-0.003},${stop.latitude-0.003},${stop.longitude+0.003},${stop.latitude+0.003}&layer=mapnik&marker=${stop.latitude},${stop.longitude}` : '';

									html += `
										<div class="timeline-item stop" id="${stopId}" data-trip-name="${trip.name}" data-duration-seconds="${stop.duration_seconds}">
											<div class="stop-card" data-stop-id="${stopId}">
												<div class="stop-header">
													<span class="stop-label">
														<i class="fa fa-pause-circle"></i> ${__('Stopp auswärts')}
													</span>
													<span class="stop-duration">${stop.duration_formatted}</span>
												</div>
												<div class="stop-location">
													<i class="fa fa-clock-o"></i>
													${this.format_time(stop.start_time)} - ${this.format_time(stop.end_time)}
													<span style="margin: 0 8px;">|</span>
													<i class="fa fa-map-marker"></i>
													${stop.location}
												</div>

												<!-- Shared fields: Customer & Project -->
												<div class="stop-shared-fields">
													<div class="form-row">
														<div class="form-group">
															<label>${__('Kunde')}<span class="required">*</span></label>
															<div class="link-field-wrapper customer-field-${stopIndex}"></div>
														</div>
														<div class="form-group">
															<label>${__('Projekt')}</label>
															<div class="link-field-wrapper project-field-${stopIndex}"></div>
														</div>
													</div>
												</div>

												<!-- Tabs -->
												<div class="stop-tabs" data-stop-id="${stopId}">
													<button class="stop-tab active" data-tab="timesheet"><i class="fa fa-clock-o"></i> ${__('Zeiterfassung')}</button>
													<button class="stop-tab" data-tab="delivery-note"><i class="fa fa-truck"></i> ${__('Lieferschein')}</button>
												</div>

												<!-- Two Column Layout: Form left, Map right -->
												<div class="stop-content">
													<!-- Left: Tab Content -->
													<div class="stop-tab-panels">
														<!-- Tab: Timesheet -->
														<div class="stop-tab-panel active" data-panel="timesheet">
															<div class="timesheet-form" data-stop-id="${stopId}"
																data-from-time="${stop.start_time}"
																data-date="${day.date}"
																data-location="${stop.location}"
																data-duration-seconds="${stop.duration_seconds}"
																data-trip-name="${trip.name}">

																<div class="form-row">
																	<div class="form-group">
																		<label>${__('Tätigkeitsart')}<span class="required">*</span></label>
																		<select class="activity-type">
																			<option value="">${__('Bitte wählen...')}</option>
																			${activityOptions}
																		</select>
																	</div>
																	<div class="form-row-inline">
																		<div class="form-group">
																			<label>${__('Dauer')} <span style="text-transform: none; font-weight: normal; color: var(--text-muted);">(${stop.duration_formatted})</span></label>
																			<div class="duration-input-wrapper">
																				<input type="number" class="duration-hours" value="${durationHours}" step="0.25" min="0.25">
																				<span class="duration-hint">${this.format_hours_display(durationHours)}</span>
																			</div>
																		</div>
																		<div class="form-group narrow">
																			<label>${__('Abrechenbar')}</label>
																			<select class="is-billable">
																				<option value="1">${__('Ja')}</option>
																				<option value="0">${__('Nein')}</option>
																			</select>
																		</div>
																	</div>
																</div>

																<div class="form-group">
																	<label>${__('Beschreibung')}<span class="required">*</span></label>
																	<textarea class="description" placeholder="${__('Was wurde gemacht?')}"></textarea>
																</div>

																<div class="form-footer">
																	<div class="time-info">
																		<i class="fa fa-clock-o"></i>
																		<span>${__('Start')}: <strong>${this.format_time(stop.start_time)}</strong></span>
																	</div>
																	<button class="btn-transfer" data-stop-index="${stopIndex}" ${!this.current_employee ? 'disabled' : ''}>
																		<i class="fa fa-plus"></i> ${__('In Timesheet übertragen')}
																	</button>
																</div>

																<div class="transfer-result" style="display: none;"></div>
															</div>
														</div>

														<!-- Tab: Delivery Note -->
														<div class="stop-tab-panel" data-panel="delivery-note">
															<div class="delivery-note-form" data-stop-id="${stopId}"
																data-date="${day.date}"
																data-trip-name="${trip.name}">

																<div class="dn-items-container">
																	<div class="dn-item-row" data-row-index="0">
																		<div class="form-group" style="flex: 1;">
																			<label>${__('Artikel')}<span class="required">*</span></label>
																			<div class="link-field-wrapper dn-item-field-${stopIndex}-0"></div>
																		</div>
																		<div class="form-group" style="width: 100px;">
																			<label>${__('Menge')}</label>
																			<input type="number" class="dn-item-qty" value="1" min="1" step="1">
																		</div>
																	</div>
																</div>

																<button class="btn-add-dn-item" data-stop-index="${stopIndex}">
																	<i class="fa fa-plus"></i> ${__('Artikel hinzufügen')}
																</button>

																<div class="form-row" style="margin-top: 16px;">
																	<div class="form-group">
																		<label class="dn-posting-date-label" style="cursor: pointer;">
																			<input type="checkbox" class="dn-set-posting-date" checked>
																			${__('Buchungsdatum setzen')}
																		</label>
																		<input type="date" class="dn-posting-date" value="${day.date}">
																	</div>
																</div>

																<div class="form-footer">
																	<div></div>
																	<button class="btn-create-dn" data-stop-index="${stopIndex}" ${!this.current_employee ? 'disabled' : ''}>
																		<i class="fa fa-truck"></i> ${__('Lieferschein erstellen')}
																	</button>
																</div>

																<div class="dn-result" style="display: none;"></div>
															</div>
														</div>
													</div>

													<!-- Right: Map -->
													${hasCoords ? `
													<div class="stop-map-container">
														<iframe src="${mapUrl}" loading="lazy"></iframe>
													</div>
													` : ''}
												</div>
											</div>
										</div>
									`;
									stopIndex++;
									vehicleStopCount++;
								}
							}
						}
					}
				}

				html += `
						</div>
					</div>
				`;
			}

			html += `</div>`;
		}

		container.html(html);

		// Initialize link fields, bind events, and duration input handlers
		this.init_link_fields(data);
		this.bind_duration_inputs();
		this.bind_transfer_buttons();
		this.bind_map_buttons();
		this.bind_trip_type_buttons();
		this.bind_link_checkboxes();
		this.bind_comment_buttons();
		this.bind_copy_comment_buttons();
		this.bind_stop_tabs();
		this.init_dn_item_fields(data);
		this.bind_add_dn_item_buttons();
		this.bind_create_dn_buttons();
	}

	bind_link_checkboxes() {
		const self = this;

		// When a trip's "ignore" checkbox is changed
		// This checkbox appears on the TRIP - when checked, the STOP AFTER this trip gets hidden
		// and its time is added to the PREVIOUS visible stop
		this.page.main.find('.trip-ignore-checkbox').on('change', function() {
			const checkbox = $(this);
			const tripIgnoreOption = checkbox.closest('.trip-ignore-option');
			const tripItem = checkbox.closest('.timeline-item.trip');

			if (checkbox.is(':checked')) {
				// Mark the trip ignore option as active
				tripIgnoreOption.addClass('active');
				tripItem.addClass('trip-ignored');
			} else {
				// Unmark
				tripIgnoreOption.removeClass('active');
				tripItem.removeClass('trip-ignored');
			}

			// Recalculate which stops should be hidden based on ignored trips
			self.recalculate_hidden_stops();

			// Recalculate the main stop's total time (previous visible stop)
			self.update_main_stop_linked_info();
		});
	}

	recalculate_hidden_stops() {
		// For each vehicle section, determine which stops should be hidden
		// A stop should be hidden if ALL trips between it and the previous visible stop are ignored
		this.page.main.find('.vehicle-section').each(function() {
			const timeline = $(this).find('.trips-timeline');
			const items = timeline.children('.timeline-item');

			let lastVisibleStop = null;
			let tripsAfterLastStop = [];

			items.each(function() {
				const item = $(this);

				if (item.hasClass('trip')) {
					// Track this trip
					tripsAfterLastStop.push(item);
				} else if (item.hasClass('stop')) {
					// Check if all trips since last visible stop are ignored
					const allTripsIgnored = tripsAfterLastStop.length > 0 &&
						tripsAfterLastStop.every(t => t.hasClass('trip-ignored'));

					if (allTripsIgnored && lastVisibleStop) {
						// Hide this stop
						if (!item.hasClass('hidden-by-ignore')) {
							item.addClass('hidden-by-ignore').slideUp(200);
						}
					} else {
						// Show this stop
						if (item.hasClass('hidden-by-ignore')) {
							item.removeClass('hidden-by-ignore').slideDown(200);
						}
						// This becomes the new last visible stop
						lastVisibleStop = item;
						tripsAfterLastStop = [];
					}
				}
			});
		});
	}

	update_main_stop_linked_info() {
		const self = this;

		// Process each vehicle section separately
		this.page.main.find('.vehicle-section').each(function() {
			const vehicleSection = $(this);
			const timeline = vehicleSection.find('.trips-timeline');

			// Find all visible (non-hidden) stops
			const allStops = timeline.find('.timeline-item.stop');

			// For each visible stop that is NOT hidden, calculate if it should include hidden stops' time
			allStops.each(function() {
				const stopItem = $(this);
				const stopCard = stopItem.find('.stop-card');

				// Skip if this stop is hidden
				if (stopItem.hasClass('hidden-by-ignore')) {
					return;
				}

				// Collect all hidden stops AND ignored trips that follow this stop
				const linkedStops = [];
				let totalLinkedStopSeconds = 0;
				let totalIgnoredTripSeconds = 0;
				let currentElement = stopItem.next();

				while (currentElement.length) {
					if (currentElement.hasClass('timeline-item')) {
						if (currentElement.hasClass('trip')) {
							// Check if this trip is ignored
							if (currentElement.hasClass('trip-ignored')) {
								// Get driving time from the trip
								const durationText = currentElement.find('.trip-duration').text();
								const tripSeconds = self.parse_duration_to_seconds(durationText);
								totalIgnoredTripSeconds += tripSeconds;
							}
						} else if (currentElement.hasClass('stop')) {
							if (currentElement.hasClass('hidden-by-ignore')) {
								// This is a hidden stop - add its time
								const durationSeconds = parseInt(currentElement.data('duration-seconds')) || 0;
								const tripName = currentElement.data('trip-name');
								linkedStops.push({
									tripName: tripName,
									durationSeconds: durationSeconds
								});
								totalLinkedStopSeconds += durationSeconds;
							} else {
								// Hit a visible stop - stop collecting
								break;
							}
						}
					}
					currentElement = currentElement.next();
				}

				// Update this stop's linked info display
				let linkedInfo = stopCard.find('.linked-stops-info');

				if (linkedStops.length > 0) {
					// Calculate total time (this stop + linked hidden stops, without driving time initially)
					const baseDurationSeconds = parseInt(stopItem.data('duration-seconds')) || 0;
					const includeDrivingTime = stopItem.data('include-driving-time') === true;
					const totalSeconds = baseDurationSeconds + totalLinkedStopSeconds + (includeDrivingTime ? totalIgnoredTripSeconds : 0);
					const totalHours = self.seconds_to_duration_value(totalSeconds);

					// Build driving time link if there's driving time to add
					let drivingTimeLink = '';
					if (totalIgnoredTripSeconds > 0 && !includeDrivingTime) {
						drivingTimeLink = `
							<div class="linked-stops-driving">
								<a href="#" class="add-driving-time-link" data-driving-seconds="${totalIgnoredTripSeconds}">
									<i class="fa fa-car"></i> ${__('Fahrzeit hinzufügen')} (${self.format_duration(totalIgnoredTripSeconds)})
								</a>
							</div>
						`;
					} else if (includeDrivingTime && totalIgnoredTripSeconds > 0) {
						drivingTimeLink = `
							<div class="linked-stops-driving included">
								<i class="fa fa-check"></i> ${__('Fahrzeit enthalten')} (${self.format_duration(totalIgnoredTripSeconds)})
								<a href="#" class="remove-driving-time-link">[${__('entfernen')}]</a>
							</div>
						`;
					}

					const infoHtml = `
						<div class="linked-stops-info">
							<div class="linked-stops-header">
								<i class="fa fa-link"></i> + ${linkedStops.length} ${__('verknüpfte Stopp(s)')}
							</div>
							<div class="linked-stops-total">
								${__('Gesamtzeit')}: <strong>${self.format_hours_display(totalHours)}</strong>
								(+ ${self.format_hours_display(totalLinkedStopSeconds / 3600)})
							</div>
							${drivingTimeLink}
						</div>
					`;

					if (linkedInfo.length) {
						linkedInfo.replaceWith(infoHtml);
					} else {
						stopCard.find('.stop-location').after(infoHtml);
					}

					// Bind click handler for add driving time link
					stopCard.find('.add-driving-time-link').off('click').on('click', function(e) {
						e.preventDefault();
						stopItem.data('include-driving-time', true);
						self.update_main_stop_linked_info();
					});

					// Bind click handler for remove driving time link
					stopCard.find('.remove-driving-time-link').off('click').on('click', function(e) {
						e.preventDefault();
						stopItem.data('include-driving-time', false);
						self.update_main_stop_linked_info();
					});

					// Update the duration input field
					const durationInput = stopCard.find('.duration-hours');
					if (durationInput.length) {
						durationInput.val(totalHours.toFixed(2));
						durationInput.trigger('change');
					}

					// Store linked trip names for transfer
					stopItem.data('linked-trips', linkedStops.map(s => s.tripName));
				} else {
					// Remove linked info if no more linked stops
					linkedInfo.remove();

					// Reset duration to original
					const baseDurationSeconds = parseInt(stopItem.data('duration-seconds')) || 0;
					const originalHours = self.seconds_to_duration_value(baseDurationSeconds);
					const durationInput = stopCard.find('.duration-hours');
					if (durationInput.length) {
						durationInput.val(originalHours.toFixed(2));
						durationInput.trigger('change');
					}

					stopItem.removeData('linked-trips');
					stopItem.removeData('include-driving-time');
				}
			});
		});
	}

	parse_duration_to_seconds(durationText) {
		// Parse duration text like "6m", "1h 30m", "2h" to seconds
		if (!durationText) return 0;

		let totalSeconds = 0;
		const hourMatch = durationText.match(/(\d+)\s*h/);
		const minMatch = durationText.match(/(\d+)\s*m/);

		if (hourMatch) {
			totalSeconds += parseInt(hourMatch[1]) * 3600;
		}
		if (minMatch) {
			totalSeconds += parseInt(minMatch[1]) * 60;
		}

		return totalSeconds;
	}

	bind_map_buttons() {
		const self = this;
		this.page.main.find('.btn-show-map').on('click', function() {
			const btn = $(this);
			const lat = parseFloat(btn.data('lat'));
			const lon = parseFloat(btn.data('lon'));
			const address = btn.data('address') || '';
			if (lat && lon) {
				self.show_map(lat, lon, address);
			}
		});
	}

	/**
	 * Show or hide the "von oben kopieren" button on the next trip
	 * based on whether the current trip now has a non-empty comment.
	 */
	update_copy_button_for_next_trip(currentTripItem) {
		// Find next trip element (skip stops)
		let next = currentTripItem.next();
		while (next.length && !next.hasClass('trip')) {
			next = next.next();
		}
		if (!next.length) return;

		const nextSection = next.find('.trip-comment-section');
		if (!nextSection.length) return;

		// Check if the DIRECT previous trip has a comment (only immediate predecessor counts)
		let hasPrevComment = false;
		let prev = next.prev();
		while (prev.length && !prev.hasClass('trip')) {
			prev = prev.prev();
		}
		if (prev.length && prev.hasClass('trip')) {
			const prevInput = prev.find('.trip-comment-input');
			hasPrevComment = !!(prevInput.length && prevInput.val() && prevInput.val().trim());
		}

		const existingBtn = nextSection.find('.btn-copy-last-comment');

		if (hasPrevComment) {
			// Show button if not already present
			if (!existingBtn.length) {
				const copyBtn = $(`<button class="btn-copy-last-comment" title="${__('Kommentar von vorheriger Fahrt übernehmen')}">
					<i class="fa fa-arrow-up"></i><i class="fa fa-copy"></i>
				</button>`);
				nextSection.find('.btn-update-comment').before(copyBtn);
				// Bind click handler on new button
				this.bind_single_copy_button(copyBtn);
			}
		} else {
			// Remove button if present
			existingBtn.remove();
		}
	}

	/**
	 * Bind click handler for a single dynamically added copy-comment button.
	 */
	bind_single_copy_button(btn) {
		const self = this;
		btn.on('click', async function() {
			const b = $(this);
			const section = b.closest('.trip-comment-section');
			const tripName = section.data('trip-name');
			const input = section.find('.trip-comment-input');

			const currentTripItem = section.closest('.timeline-item.trip');
			let prevComment = '';
			let prev = currentTripItem.prev();

			while (prev.length) {
				if (prev.hasClass('trip')) {
					const prevInput = prev.find('.trip-comment-input');
					if (prevInput.length && prevInput.val().trim()) {
						prevComment = prevInput.val().trim();
						break;
					}
				}
				prev = prev.prev();
			}

			if (!prevComment) {
				frappe.show_alert({
					message: __('Kein vorheriger Kommentar gefunden'),
					indicator: 'orange'
				});
				return;
			}

			input.val(prevComment);
			b.prop('disabled', true);

			try {
				const result = await frappe.call({
					method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.update_trip_comment',
					args: {
						trip_name: tripName,
						comment: prevComment
					}
				});

				if (result.message && result.message.success) {
					section.find('.comment-missing-indicator').remove();
					frappe.show_alert({
						message: __('Kommentar übernommen'),
						indicator: 'green'
					});
					// Update copy button on the next trip
					self.update_copy_button_for_next_trip(currentTripItem);
				}
			} catch (error) {
				console.error('Copy comment error:', error);
				frappe.show_alert({
					message: __('Fehler beim Speichern'),
					indicator: 'red'
				});
			}

			b.prop('disabled', false);
		});
	}

	bind_comment_buttons() {
		const self = this;
		// Edit/Save comment button
		this.page.main.find('.btn-update-comment').on('click', async function() {
			const btn = $(this);
			const section = btn.closest('.trip-comment-section');
			const input = section.find('.trip-comment-input');
			const tripName = section.data('trip-name');

			if (input.attr('readonly')) {
				// Switch to edit mode
				input.removeAttr('readonly').focus();
				btn.addClass('editing').html('<i class="fa fa-check"></i>');
			} else {
				// Save the comment
				const newComment = input.val();
				btn.addClass('saving').prop('disabled', true);

				try {
					const result = await frappe.call({
						method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.update_trip_comment',
						args: {
							trip_name: tripName,
							comment: newComment
						}
					});

					if (result.message && result.message.success) {
						// Remove the orange ? if comment is now non-empty
						if (newComment.trim()) {
							section.find('.comment-missing-indicator').remove();
						}
						frappe.show_alert({
							message: __('Kommentar gespeichert'),
							indicator: 'green'
						});
						// Update copy button on the next trip
						const currentTripItem = section.closest('.timeline-item.trip');
						self.update_copy_button_for_next_trip(currentTripItem);
					}
				} catch (error) {
					console.error('Comment update error:', error);
					frappe.show_alert({
						message: __('Fehler beim Speichern'),
						indicator: 'red'
					});
				}

				// Switch back to readonly mode
				input.attr('readonly', true);
				btn.removeClass('editing saving').prop('disabled', false).html('<i class="fa fa-pencil"></i>');
			}
		});

		// Allow Enter key to save
		this.page.main.find('.trip-comment-input').on('keypress', function(e) {
			if (e.which === 13) {
				$(this).closest('.trip-comment-section').find('.btn-update-comment').click();
			}
		});
	}

	bind_copy_comment_buttons() {
		this.page.main.find('.btn-copy-last-comment').on('click', async function() {
			const btn = $(this);
			const section = btn.closest('.trip-comment-section');
			const tripName = section.data('trip-name');
			const input = section.find('.trip-comment-input');

			// Find the previous trip's comment by walking back through timeline items
			const currentTripItem = section.closest('.timeline-item.trip');
			let prevComment = '';
			let prev = currentTripItem.prev();

			while (prev.length) {
				if (prev.hasClass('trip')) {
					const prevInput = prev.find('.trip-comment-input');
					if (prevInput.length && prevInput.val().trim()) {
						prevComment = prevInput.val().trim();
						break;
					}
				}
				prev = prev.prev();
			}

			if (!prevComment) {
				frappe.show_alert({
					message: __('Kein vorheriger Kommentar gefunden'),
					indicator: 'orange'
				});
				return;
			}

			// Set the comment and save it
			input.val(prevComment);
			btn.prop('disabled', true);

			try {
				const result = await frappe.call({
					method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.update_trip_comment',
					args: {
						trip_name: tripName,
						comment: prevComment
					}
				});

				if (result.message && result.message.success) {
					// Remove the orange ? indicator
					section.find('.comment-missing-indicator').remove();
					frappe.show_alert({
						message: __('Kommentar übernommen'),
						indicator: 'green'
					});
				}
			} catch (error) {
				console.error('Copy comment error:', error);
				frappe.show_alert({
					message: __('Fehler beim Speichern'),
					indicator: 'red'
				});
			}

			btn.prop('disabled', false);
		});
	}

	bind_stop_tabs() {
		this.page.main.find('.stop-tab').on('click', function() {
			const btn = $(this);
			const tabsContainer = btn.closest('.stop-card');
			const tabName = btn.data('tab');

			// Switch active tab button
			tabsContainer.find('.stop-tab').removeClass('active');
			btn.addClass('active');

			// Switch active panel
			tabsContainer.find('.stop-tab-panel').removeClass('active');
			tabsContainer.find(`.stop-tab-panel[data-panel="${tabName}"]`).addClass('active');
		});
	}

	init_dn_item_fields(data) {
		let stopIndex = 0;

		for (const day of data.days) {
			for (const vehicle of day.vehicles) {
				for (let i = 0; i < vehicle.trips.length; i++) {
					const trip = vehicle.trips[i];
					if (trip.reason === 'PRIVATE') continue;

					const stop = vehicle.stops_outside_home.find(s => s.after_trip === trip.name);
					if (stop && !trip.billed) {
						// Initialize first item field for this stop
						this.create_dn_item_field(stopIndex, 0);
						stopIndex++;
					}
				}
			}
		}
	}

	create_dn_item_field(stopIndex, rowIndex) {
		const wrapper = this.page.main.find(`.dn-item-field-${stopIndex}-${rowIndex}`);
		if (!wrapper.length) return;

		const itemField = frappe.ui.form.make_control({
			parent: wrapper,
			df: {
				fieldtype: 'Link',
				options: 'Item',
				fieldname: `dn_item_${stopIndex}_${rowIndex}`,
				placeholder: __('Artikel auswählen...')
			},
			render_input: true
		});
		itemField.refresh();
		wrapper.data('field', itemField);
	}

	bind_add_dn_item_buttons() {
		const self = this;
		this.page.main.find('.btn-add-dn-item').on('click', function() {
			const btn = $(this);
			const stopIndex = btn.data('stop-index');
			const container = btn.siblings('.dn-items-container');
			const rowIndex = container.find('.dn-item-row').length;

			const newRow = $(`
				<div class="dn-item-row" data-row-index="${rowIndex}">
					<div class="form-group" style="flex: 1;">
						<div class="link-field-wrapper dn-item-field-${stopIndex}-${rowIndex}"></div>
					</div>
					<div class="form-group" style="width: 100px;">
						<input type="number" class="dn-item-qty" value="1" min="1" step="1">
					</div>
					<button class="btn-remove-dn-item" title="${__('Entfernen')}">
						<i class="fa fa-times"></i>
					</button>
				</div>
			`);

			container.append(newRow);
			self.create_dn_item_field(stopIndex, rowIndex);

			// Bind remove button
			newRow.find('.btn-remove-dn-item').on('click', function() {
				$(this).closest('.dn-item-row').remove();
			});
		});
	}

	bind_create_dn_buttons() {
		const self = this;

		this.page.main.find('.btn-create-dn').on('click', async function() {
			const btn = $(this);
			const stopIndex = btn.data('stop-index');
			const form = btn.closest('.delivery-note-form');

			// Get customer from shared field
			const customerWrapper = self.page.main.find(`.customer-field-${stopIndex}`);
			const customerField = customerWrapper.data('field');
			const customer = customerField ? customerField.get_value() : null;

			const projectWrapper = self.page.main.find(`.project-field-${stopIndex}`);
			const projectField = projectWrapper.data('field');
			const project = projectField ? projectField.get_value() : null;

			const tripName = form.data('trip-name');

			// Collect items
			const items = [];
			form.find('.dn-item-row').each(function() {
				const row = $(this);
				const itemWrapper = row.find('[class*="dn-item-field-"]');
				const itemField = itemWrapper.data('field');
				const itemCode = itemField ? itemField.get_value() : null;
				const qty = parseFloat(row.find('.dn-item-qty').val()) || 0;

				if (itemCode && qty > 0) {
					items.push({item_code: itemCode, qty: qty});
				}
			});

			// Get posting date
			let postingDate = null;
			if (form.find('.dn-set-posting-date').is(':checked')) {
				postingDate = form.find('.dn-posting-date').val();
			}

			// Validation
			if (!customer) {
				frappe.msgprint(__('Bitte wählen Sie einen Kunden aus'));
				return;
			}
			if (items.length === 0) {
				frappe.msgprint(__('Bitte fügen Sie mindestens einen Artikel hinzu'));
				return;
			}

			btn.prop('disabled', true).html(`<i class="fa fa-spinner fa-spin"></i> ${__('Erstelle...')}`);

			try {
				const result = await frappe.call({
					method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.create_delivery_note',
					args: {
						customer: customer,
						items_json: JSON.stringify(items),
						posting_date: postingDate,
						project: project || null,
						trip_name: tripName
					}
				});

				const data = result.message;

				if (data.success) {
					const resultDiv = form.find('.dn-result');
					resultDiv.html(`
						<div class="transfer-success">
							<i class="fa fa-check-circle"></i>
							${__('Lieferschein erstellt')}:
							<a href="/app/delivery-note/${data.delivery_note}" target="_blank">${data.delivery_note}</a>
							(${__('Entwurf')})
						</div>
					`).show();

					// Hide form inputs
					form.find('.dn-items-container, .btn-add-dn-item, .form-row, .form-footer').hide();

					frappe.show_alert({
						message: data.message,
						indicator: 'green'
					});
				} else {
					frappe.msgprint({
						title: __('Fehler'),
						message: data.message || __('Erstellung fehlgeschlagen'),
						indicator: 'red'
					});
					btn.prop('disabled', false).html(`<i class="fa fa-truck"></i> ${__('Lieferschein erstellen')}`);
				}
			} catch (error) {
				console.error('Delivery Note creation error:', error);
				frappe.msgprint({
					title: __('Fehler'),
					message: error.message || __('Erstellung fehlgeschlagen'),
					indicator: 'red'
				});
				btn.prop('disabled', false).html(`<i class="fa fa-truck"></i> ${__('Lieferschein erstellen')}`);
			}
		});
	}

	// Update trip comment field when customer/description changes in stop form
	update_trip_comment_from_stop(tripName, customerName, description) {
		const commentText = description ? `${customerName} ${description}` : customerName;
		const tripCard = this.page.main.find(`.trip-comment-section[data-trip-name="${tripName}"]`);
		if (tripCard.length) {
			tripCard.find('.trip-comment-input').val(commentText);
		}
	}

	bind_trip_type_buttons() {
		this.page.main.find('.btn-trip-type').on('click', async function() {
			const btn = $(this);
			const buttonGroup = btn.closest('.trip-type-buttons');
			const tripName = buttonGroup.data('trip-name');
			const reason = btn.data('reason');

			// Skip if already active
			if (btn.hasClass('active')) {
				return;
			}

			// Disable all buttons in this group while updating
			const allButtons = buttonGroup.find('.btn-trip-type');
			allButtons.prop('disabled', true);

			try {
				const result = await frappe.call({
					method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.update_trip_reason',
					args: {
						trip_name: tripName,
						reason: reason
					}
				});

				const data = result.message;

				if (data.success) {
					// Update button states
					allButtons.removeClass('active');
					btn.addClass('active');

					// Update trip card styling if needed
					const tripCard = btn.closest('.trip-card');
					const timelineItem = btn.closest('.timeline-item');

					// Remove old classes
					tripCard.removeClass('private');
					timelineItem.removeClass('private');

					// Handle stop visibility based on private/business
					const nextElement = timelineItem.next();
					const isNextAStop = nextElement.hasClass('stop');

					if (reason === 'PRIVATE') {
						tripCard.addClass('private');
						timelineItem.addClass('private');

						// Remove the ? indicator for private trips
						tripCard.find('.comment-missing-indicator').remove();

						// Hide the stop card for private trips
						if (isNextAStop) {
							nextElement.slideUp(200).addClass('hidden-by-private');
						}
					} else {
						// Show the stop card again if it was hidden by private
						if (isNextAStop && nextElement.hasClass('hidden-by-private')) {
							nextElement.slideDown(200).removeClass('hidden-by-private');
						}

						// Re-add the ? indicator if comment is empty
						const commentSection = tripCard.find('.trip-comment-section');
						const commentInput = commentSection.find('.trip-comment-input');
						if (!commentInput.val() || !commentInput.val().trim()) {
							if (!commentSection.find('.comment-missing-indicator').length) {
								commentSection.find('.comment-input-row').prepend(
									'<span class="comment-missing-indicator" title="' + __('Kommentar fehlt') + '">?</span>'
								);
							}
						}
					}

					frappe.show_alert({
						message: data.message,
						indicator: 'green'
					});
				} else {
					frappe.msgprint({
						title: __('Fehler'),
						message: data.message || __('Aktualisierung fehlgeschlagen'),
						indicator: 'red'
					});
				}
			} catch (error) {
				console.error('Trip type update error:', error);
				frappe.msgprint({
					title: __('Fehler'),
					message: error.message || __('Aktualisierung fehlgeschlagen'),
					indicator: 'red'
				});
			} finally {
				// Re-enable buttons
				allButtons.prop('disabled', false);
			}
		});
	}

	init_link_fields(data) {
		const self = this;
		let stopIndex = 0;

		for (const day of data.days) {
			for (const vehicle of day.vehicles) {
				for (let i = 0; i < vehicle.trips.length; i++) {
					const trip = vehicle.trips[i];

					// Skip private trips - no timesheet form for them
					if (trip.reason === 'PRIVATE') continue;

					const stop = vehicle.stops_outside_home.find(s => s.after_trip === trip.name);

					// Skip if billed
					if (stop && !trip.billed) {
						// Customer field
						const customerWrapper = this.page.main.find(`.customer-field-${stopIndex}`);
						if (customerWrapper.length) {
							const customerField = frappe.ui.form.make_control({
								parent: customerWrapper,
								df: {
									fieldtype: 'Link',
									options: 'Customer',
									fieldname: `customer_${stopIndex}`,
									placeholder: __('Kunde auswählen...')
								},
								render_input: true
							});
							customerField.refresh();
							customerWrapper.data('field', customerField);

							// When customer changes, update project field filter and trip comment
							const currentStopIndex = stopIndex;
							const currentTripName = trip.name;
							customerField.$input.on('change', function() {
								const customer = customerField.get_value();
								const projectWrapper = self.page.main.find(`.project-field-${currentStopIndex}`);
								const projectField = projectWrapper.data('field');
								if (projectField) {
									projectField.set_value('');
									if (customer) {
										projectField.df.get_query = () => ({
											filters: {
												customer: customer,
												status: ['not in', ['Completed', 'Cancelled']]
											}
										});
									}
								}

								// Live-update trip comment with customer name
								if (customer) {
									// Get customer name and update trip comment
									frappe.db.get_value('Customer', customer, 'customer_name').then(r => {
										const customerName = r.message?.customer_name || customer;
										const form = self.page.main.find(`.timesheet-form[data-trip-name="${currentTripName}"]`);
										const description = form.find('.description').val() || '';
										self.update_trip_comment_from_stop(currentTripName, customerName, description);
									});
								}
							});
						}

						// Project field
						const projectWrapper = this.page.main.find(`.project-field-${stopIndex}`);
						if (projectWrapper.length) {
							const projectField = frappe.ui.form.make_control({
								parent: projectWrapper,
								df: {
									fieldtype: 'Link',
									options: 'Project',
									fieldname: `project_${stopIndex}`,
									placeholder: __('Projekt auswählen...')
								},
								render_input: true
							});
							projectField.refresh();
							projectWrapper.data('field', projectField);
						}

						stopIndex++;
					}
				}
			}
		}

		// Bind description field changes for live comment update
		this.page.main.find('.timesheet-form .description').on('input', function() {
			const form = $(this).closest('.timesheet-form');
			const tripName = form.data('trip-name');

			// Try to get customer from the form's customer field
			const formContainer = form.closest('.stop-card');
			const allCustomerFields = formContainer.find('[class*="customer-field-"]');
			allCustomerFields.each(function() {
				const field = $(this).data('field');
				if (field) {
					const customer = field.get_value();
					if (customer) {
						// We have the customer ID, get the name
						frappe.db.get_value('Customer', customer, 'customer_name').then(r => {
							const name = r.message?.customer_name || customer;
							const description = form.find('.description').val() || '';
							self.update_trip_comment_from_stop(tripName, name, description);
						});
						return false; // break
					}
				}
			});
		});
	}

	bind_duration_inputs() {
		const self = this;
		this.page.main.find('.duration-hours').on('input change', function() {
			const input = $(this);
			const hours = parseFloat(input.val()) || 0;
			const hintSpan = input.siblings('.duration-hint');
			hintSpan.text(self.format_hours_display(hours));
		});
	}

	bind_transfer_buttons() {
		const self = this;

		this.page.main.find('.btn-transfer').on('click', async function() {
			const btn = $(this);
			const stopIndex = btn.data('stop-index');
			const form = btn.closest('.timesheet-form');
			const stopCard = btn.closest('.stop-card');

			// Get form values
			const customerWrapper = self.page.main.find(`.customer-field-${stopIndex}`);
			const customerField = customerWrapper.data('field');
			const customer = customerField ? customerField.get_value() : null;

			const projectWrapper = self.page.main.find(`.project-field-${stopIndex}`);
			const projectField = projectWrapper.data('field');
			const project = projectField ? projectField.get_value() : null;

			const activityType = form.find('.activity-type').val();
			const description = form.find('.description').val();
			const isBillable = form.find('.is-billable').val();
			const durationHours = parseFloat(form.find('.duration-hours').val()) || 0;
			const fromTime = form.data('from-time');
			const tripName = form.data('trip-name');

			// Get linked trips from the stop item (set by update_main_stop_linked_info)
			const stopItem = stopCard.closest('.timeline-item.stop');
			const linkedTrips = stopItem.data('linked-trips') || [];

			// Validation
			if (!customer) {
				frappe.msgprint(__('Bitte wählen Sie einen Kunden aus'));
				return;
			}
			if (!activityType) {
				frappe.msgprint(__('Bitte wählen Sie eine Tätigkeitsart aus'));
				return;
			}
			if (!description || !description.trim()) {
				frappe.msgprint(__('Bitte geben Sie eine Beschreibung ein'));
				return;
			}
			if (durationHours <= 0) {
				frappe.msgprint(__('Bitte geben Sie eine gültige Dauer ein'));
				return;
			}

			btn.prop('disabled', true).html(`<i class="fa fa-spinner fa-spin"></i> ${__('Übertrage...')}`);

			try {
				const result = await frappe.call({
					method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.add_timesheet_entry',
					args: {
						customer: customer,
						from_time: fromTime,
						duration_hours: durationHours,
						activity_type: activityType,
						description: description,
						is_billable: isBillable,
						project: project || null,
						trip_name: tripName,
						linked_trips: linkedTrips.length > 0 ? JSON.stringify(linkedTrips) : null
					}
				});

				const data = result.message;

				if (data.success) {
					// Build linked stops message
					let linkedMsg = '';
					if (linkedTrips.length > 0) {
						linkedMsg = `<br><small>${__('+ {0} verknüpfte Stopp(s)', [linkedTrips.length])}</small>`;
					}

					// Show success message
					const resultDiv = form.find('.transfer-result');
					resultDiv.html(`
						<div class="transfer-success">
							<i class="fa fa-check-circle"></i>
							${data.hours}h ${__('übertragen zu')}
							<a href="/app/timesheet/${data.timesheet}" target="_blank">${data.timesheet}</a>
							${data.timesheet_created ? `(${__('neu erstellt')})` : ''}
							${linkedMsg}
						</div>
					`).show();

					// Update card styling
					stopCard.addClass('transferred');

					// Hide form elements, show only result
					form.find('.form-grid, .form-footer').hide();

					// Mark linked stops as transferred
					linkedTrips.forEach(linkedTripName => {
						const linkedStop = stopCard.closest('.vehicle-section').find(`.timeline-item.stop[data-trip-name="${linkedTripName}"]`);
						linkedStop.find('.stop-card').addClass('transferred');
						linkedStop.find('.stop-ignore-checkbox').prop('disabled', true);
						linkedStop.find('.stop-ignore-label').html(`<i class="fa fa-check"></i> ${__('Verknüpft mit')} <a href="/app/timesheet/${data.timesheet}" target="_blank">${data.timesheet}</a>`);
					});

					frappe.show_alert({
						message: data.message + (linkedTrips.length > 0 ? ` (+ ${linkedTrips.length} ${__('verknüpfte Stopps')})` : ''),
						indicator: 'green'
					});

					// Update trip comment in DOM and copy button on the next trip
					const stopItem = stopCard.closest('.timeline-item.stop');
					let tripItem = stopItem.prev();
					while (tripItem.length && !tripItem.hasClass('trip')) {
						tripItem = tripItem.prev();
					}
					if (tripItem.length && data.comment) {
						tripItem.find('.trip-comment-input').val(data.comment);
						tripItem.find('.comment-missing-indicator').remove();
						self.update_copy_button_for_next_trip(tripItem);
					}
				} else {
					frappe.msgprint({
						title: __('Fehler'),
						message: data.message || __('Übertragung fehlgeschlagen'),
						indicator: 'red'
					});
					btn.prop('disabled', false).html(`<i class="fa fa-plus"></i> ${__('In Timesheet übertragen')}`);
				}
			} catch (error) {
				console.error('Transfer error:', error);
				frappe.msgprint({
					title: __('Fehler'),
					message: error.message || __('Übertragung fehlgeschlagen'),
					indicator: 'red'
				});
				btn.prop('disabled', false).html(`<i class="fa fa-plus"></i> ${__('In Timesheet übertragen')}`);
			}
		});
	}

	render_summary_view(data) {
		const container = this.page.main.find('.trips-data-container');

		if (!data.days || data.days.length === 0) {
			container.html(`
				<div class="empty-state">
					<i class="fa fa-car"></i>
					<h4>${__('Keine Fahrten gefunden')}</h4>
					<p>${__('Im ausgewählten Zeitraum wurden keine abgeschlossenen Fahrten gefunden.')}</p>
				</div>
			`);
			return;
		}

		let html = `
			<table class="summary-table">
				<thead>
					<tr>
						<th>${__('Datum')}</th>
						<th>${__('Fahrzeug')}</th>
						<th class="text-right">${__('Fahrten')}</th>
						<th class="text-right">${__('Distanz')}</th>
						<th class="text-right">${__('Fahrzeit')}</th>
						<th class="text-right">${__('Stopps auswärts')}</th>
						<th class="text-right">${__('Zeit auswärts')}</th>
					</tr>
				</thead>
				<tbody>
		`;

		for (const day of data.days) {
			for (const vehicle of day.vehicles) {
				html += `
					<tr>
						<td>${this.format_date(day.date)}</td>
						<td><span class="vehicle-plate">${vehicle.license_plate || vehicle.vehicle_id}</span></td>
						<td class="text-right">${vehicle.trips.length}</td>
						<td class="text-right">${vehicle.total_distance} km</td>
						<td class="text-right">${vehicle.total_driving_time_formatted}</td>
						<td class="text-right">${vehicle.stops_outside_home.length}</td>
						<td class="text-right"><strong>${vehicle.total_stop_time_outside_formatted}</strong></td>
					</tr>
				`;
			}
		}

		html += `
				</tbody>
			</table>
		`;

		container.html(html);
	}
}
