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
		this.vehicles = [];
		this.ready = false;
		this._request_id = 0;
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
			this.load_current_employee(),
			this.load_vehicles()
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
		// Employee Filter
		this.employee_field = this.page.add_field({
			fieldname: 'employee',
			label: __('Mitarbeiter'),
			fieldtype: 'Link',
			options: 'Employee',
			change: () => {
				this.current_employee = this.employee_field.get_value()
					? { name: this.employee_field.get_value() }
					: null;
				this.render_employee_info();

				// Re-render vehicle buttons (filters by employee) and auto-select
				this.selected_vehicle = null;
				if (this.vehicles) {
					this.render_vehicle_buttons();
				}

				this.refresh_data();
			}
		});

		// Vehicle selection is handled via buttons in make_content()
		this.selected_vehicle = null;

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

				<!-- Vehicle Buttons -->
				<div class="vehicle-buttons-container mb-4"></div>

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
			// Set the employee field to the current user's employee
			if (this.current_employee) {
				this.employee_field.set_value(this.current_employee.name);
			}
			this.render_employee_info();
		} catch (error) {
			console.error('Error loading employee:', error);
		}
	}

	async load_vehicles() {
		try {
			const result = await frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.get_vehicles'
			});
			this.vehicles = result.message || [];
			this.render_vehicle_buttons();
		} catch (error) {
			console.error('Error loading vehicles:', error);
		}
	}

	render_vehicle_buttons() {
		const container = this.page.main.find('.vehicle-buttons-container');
		const currentEmployee = this.employee_field.get_value();

		let html = '';
		for (const v of this.vehicles) {
			const isActive = this.selected_vehicle === v.vehicle_id ? ' active' : '';
			const desc = v.description ? `<span class="vehicle-desc">(${v.description})</span>` : '';
			html += `<button class="btn-vehicle${isActive}" data-vehicle-id="${v.vehicle_id}">
				<i class="fa fa-car"></i>
				<span class="vehicle-plate">${v.license_plate}</span>
				${desc}
			</button>`;
		}
		container.html(html);

		// Bind click events
		container.find('.btn-vehicle').on('click', (e) => {
			const btn = $(e.currentTarget);
			const vehicleId = btn.data('vehicle-id');

			if (this.selected_vehicle === vehicleId) {
				// Deselect - show all
				this.selected_vehicle = null;
				container.find('.btn-vehicle').removeClass('active');
			} else {
				this.selected_vehicle = vehicleId;
				container.find('.btn-vehicle').removeClass('active');
				btn.addClass('active');
			}
			this.refresh_data();
		});

		// Auto-select vehicle assigned to current employee
		if (currentEmployee && !this.selected_vehicle) {
			const assignedVehicle = this.vehicles.find(v => v.employee === currentEmployee);
			if (assignedVehicle) {
				this.selected_vehicle = assignedVehicle.vehicle_id;
				container.find(`[data-vehicle-id="${assignedVehicle.vehicle_id}"]`).addClass('active');
			}
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
		const employeeValue = this.employee_field.get_value();

		if (!employeeValue) {
			container.show();
			infoSpan.html(
				`<span class="text-danger">${__('Kein Mitarbeiter ausgewählt. Timesheet-Übertragung nicht möglich.')}</span>`
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

		const request_id = ++this._request_id;
		const container = this.page.main.find('.trips-data-container');
		container.html(`<div class="loading-indicator"><i class="fa fa-spinner fa-spin"></i> ${__('Lade Daten...')}</div>`);

		try {
			const result = await frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.get_trips_overview',
				args: {
					vehicle: this.selected_vehicle || null,
					from_date: this.from_date_field.get_value() || null,
					to_date: this.to_date_field.get_value() || null,
					employee: this.employee_field.get_value() || null
				}
			});

			// Discard stale responses
			if (request_id !== this._request_id) return;

			const data = result.message;
			this.update_summary_cards(data);

			const viewMode = this.view_mode_field.get_value();
			if (viewMode === 'summary') {
				this.render_summary_view(data);
			} else {
				this.render_detail_view(data);
			}
		} catch (error) {
			if (request_id !== this._request_id) return;
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
					} else if (trip.reason === 'BUSINESS' && trip.private_distance && trip.private_distance > 0) {
						// Business trip with a partial private split
						businessDistance += Math.max(0, distance - trip.private_distance);
						privateDistance += trip.private_distance;
					} else {
						// Fully BUSINESS or COMMUTE count as business
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
				let lastTripBusinessKm = null; // Track previous trip's business km for the copy button

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
					const isBusiness = trip.reason === 'BUSINESS';
					// Business portion: use stored split if a private part was recorded,
					// otherwise default to the full distance (= fully business).
					const tripDistance = trip.distance || 0;
					const businessKm = (trip.private_distance && trip.private_distance > 0)
						? Math.max(0, tripDistance - trip.private_distance)
						: tripDistance;
					const privateRemainder = Math.max(0, tripDistance - businessKm);
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
								<div class="trip-business-split" data-trip-name="${trip.name}" style="${isBusiness ? '' : 'display:none;'}">
									<label class="business-split-label"><i class="fa fa-briefcase"></i> ${__('davon geschäftlich')}:</label>
									<input type="number" class="business-km-input" value="${businessKm.toFixed(1)}" min="0" max="${tripDistance.toFixed(1)}" step="0.1" readonly>
									<span class="business-split-unit">km</span>
									${lastTripBusinessKm !== null ? `<button class="btn-copy-last-business" data-last-business="${lastTripBusinessKm.toFixed(1)}" title="${__('Geschäftliche km von vorheriger Fahrt übernehmen')}"><i class="fa fa-arrow-up"></i><i class="fa fa-copy"></i></button>` : ''}
									<button class="btn-edit-business" title="${__('Geschäftliche km bearbeiten')}"><i class="fa fa-pencil"></i></button>
									<span class="business-split-private-hint">(${privateRemainder.toFixed(1)} km ${__('privat')})</span>
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
					// Track previous trip's business km so the next trip can copy it
					lastTripBusinessKm = businessKm;

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
													<div class="stop-links">
														${trip.timesheet ? `<div class="billed-info" style="margin: 0;">
															<i class="fa fa-file-text-o"></i>
															<a href="/app/timesheet/${trip.timesheet}" target="_blank">${trip.timesheet}</a>
														</div>` : ''}
														${trip.delivery_note ? `<div class="billed-info" style="margin: ${trip.timesheet ? '6px' : '0'} 0 0 0;">
															<i class="fa fa-truck"></i>
															<a href="/app/delivery-note/${trip.delivery_note}" target="_blank">${trip.delivery_note}</a>
														</div>` : ''}
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
		this.bind_business_split();
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

					// Show the business-split input only for business trips.
					// Switching to BUSINESS resets the trip to fully business
					// (update_trip_reason sends privateDistanceInNonPrivateTrip = 0),
					// so reset the input to the full distance.
					const splitRow = tripCard.find('.trip-business-split');
					if (reason === 'BUSINESS') {
						const splitInput = splitRow.find('.business-km-input');
						const maxKm = parseFloat(splitInput.attr('max')) || 0;
						splitInput.val(maxKm.toFixed(1));
						splitRow.find('.business-split-private-hint').text(`(0.0 km ${__('privat')})`);
						splitRow.show();
					} else {
						splitRow.hide();
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

	bind_business_split() {
		const self = this;

		// Update the "(X km privat)" hint live while typing
		this.page.main.find('.business-km-input').on('input', function() {
			const input = $(this);
			const row = input.closest('.trip-business-split');
			const maxKm = parseFloat(input.attr('max')) || 0;
			let businessKm = parseFloat(input.val());
			if (isNaN(businessKm) || businessKm < 0) businessKm = 0;
			if (businessKm > maxKm) businessKm = maxKm;
			const priv = Math.max(0, maxKm - businessKm);
			row.find('.business-split-private-hint').text(`(${priv.toFixed(1)} km ${__('privat')})`);
		});

		// Edit / Save button (same pattern as the comment pencil)
		this.page.main.find('.btn-edit-business').on('click', async function() {
			const btn = $(this);
			const row = btn.closest('.trip-business-split');
			const input = row.find('.business-km-input');

			if (input.attr('readonly')) {
				// Switch to edit mode
				input.removeAttr('readonly').focus().select();
				btn.addClass('editing').html('<i class="fa fa-check"></i>');
			} else {
				// Save, then switch back to readonly mode
				btn.addClass('saving').prop('disabled', true);
				await self.save_business_split(row);
				input.attr('readonly', true);
				btn.removeClass('editing saving').prop('disabled', false).html('<i class="fa fa-pencil"></i>');
			}
		});

		// Allow Enter key to save
		this.page.main.find('.business-km-input').on('keypress', function(e) {
			if (e.which === 13) {
				$(this).closest('.trip-business-split').find('.btn-edit-business').click();
			}
		});

		// Copy business km from the previous trip -> fill and save immediately
		this.page.main.find('.btn-copy-last-business').on('click', async function() {
			const btn = $(this);
			const row = btn.closest('.trip-business-split');
			const input = row.find('.business-km-input');
			const maxKm = parseFloat(input.attr('max')) || 0;
			let v = parseFloat(btn.data('last-business'));
			if (isNaN(v)) return;
			if (v > maxKm) v = maxKm;
			if (v < 0) v = 0;
			input.val(v.toFixed(1)).trigger('input');
			await self.save_business_split(row);
		});
	}

	async save_business_split(row) {
		const input = row.find('.business-km-input');
		const tripName = row.data('trip-name');
		const maxKm = parseFloat(input.attr('max')) || 0;
		let businessKm = parseFloat(input.val());
		if (isNaN(businessKm) || businessKm < 0) businessKm = 0;
		if (businessKm > maxKm) businessKm = maxKm;
		businessKm = Math.round(businessKm * 10) / 10;
		input.val(businessKm.toFixed(1));

		input.prop('disabled', true);
		try {
			const result = await frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_trips.yeshugo_trips.update_trip_business_split',
				args: {
					trip_name: tripName,
					business_km: businessKm
				}
			});

			const data = result.message;
			if (data && data.success) {
				row.find('.business-split-private-hint').text(`(${data.private_km.toFixed(1)} km ${__('privat')})`);
				frappe.show_alert({ message: data.message, indicator: 'green' });
			} else {
				frappe.msgprint({
					title: __('Fehler'),
					message: (data && data.message) || __('Aktualisierung fehlgeschlagen'),
					indicator: 'red'
				});
			}
		} catch (error) {
			console.error('Business split update error:', error);
			frappe.msgprint({
				title: __('Fehler'),
				message: error.message || __('Aktualisierung fehlgeschlagen'),
				indicator: 'red'
			});
		} finally {
			input.prop('disabled', false);
		}
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
						linked_trips: linkedTrips.length > 0 ? JSON.stringify(linkedTrips) : null,
						employee: self.employee_field.get_value() || null
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
