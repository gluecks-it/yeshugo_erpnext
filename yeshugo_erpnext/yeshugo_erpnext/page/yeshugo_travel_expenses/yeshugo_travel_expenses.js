frappe.pages['yeshugo-travel-expenses'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Reisespesenabrechnung'),
		single_column: true
	});

	new YesHugoTravelExpensesPage(page);
};

class YesHugoTravelExpensesPage {
	constructor(page) {
		this.page = page;
		this.vehicles = [];
		this.current_employee = null;
		this.rate_per_km = 0.30;
		this.ready = false;
		this._request_id = 0;
		this.make_filters();
		this.make_content();
		this.load_initial_data().then(() => {
			this.ready = true;
			this.refresh();
		});
	}

	async load_initial_data() {
		await Promise.all([
			this.load_current_employee(),
			this.load_vehicles()
		]);
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
				this.selected_vehicle = null;
				if (this.vehicles) {
					this.render_vehicle_buttons();
				}
				this.refresh();
			}
		});

		// Vehicle selection is handled via buttons in make_content()
		this.selected_vehicle = null;

		// Month Select
		const now = new Date();
		this.month_field = this.page.add_field({
			fieldname: 'month',
			label: __('Monat'),
			fieldtype: 'Select',
			options: [
				{ label: 'Januar', value: '1' },
				{ label: 'Februar', value: '2' },
				{ label: 'M\u00e4rz', value: '3' },
				{ label: 'April', value: '4' },
				{ label: 'Mai', value: '5' },
				{ label: 'Juni', value: '6' },
				{ label: 'Juli', value: '7' },
				{ label: 'August', value: '8' },
				{ label: 'September', value: '9' },
				{ label: 'Oktober', value: '10' },
				{ label: 'November', value: '11' },
				{ label: 'Dezember', value: '12' }
			],
			default: String(now.getMonth() + 1),
			change: () => this.refresh()
		});

		// Year Select
		const currentYear = now.getFullYear();
		const yearOptions = [];
		for (let y = currentYear - 2; y <= currentYear + 1; y++) {
			yearOptions.push({ label: String(y), value: String(y) });
		}
		this.year_field = this.page.add_field({
			fieldname: 'year',
			label: __('Jahr'),
			fieldtype: 'Select',
			options: yearOptions,
			default: String(currentYear),
			change: () => this.refresh()
		});

		// Reason filter
		this.reason_field = this.page.add_field({
			fieldname: 'reason_filter',
			label: __('Fahrtentyp'),
			fieldtype: 'Select',
			options: [
				{ label: __('Nur gesch\u00e4ftlich'), value: 'BUSINESS' },
				{ label: __('Alle'), value: '' },
				{ label: __('Nur privat'), value: 'PRIVATE' },
				{ label: __('Nur Arbeitsweg'), value: 'COMMUTE' }
			],
			default: 'BUSINESS',
			change: () => this.refresh()
		});

		// Print button
		this.page.set_secondary_action(__('Drucken'), () => window.print(), 'printer');
	}

	make_content() {
		this.page.main.html(`
			<div class="travel-expenses-container">
				<!-- Vehicle Buttons -->
				<div class="vehicle-buttons-container mb-4 no-print"></div>

				<!-- Month Navigation -->
				<div class="month-nav mb-4 no-print">
					<button class="btn btn-default btn-sm btn-prev-month">
						<i class="fa fa-chevron-left"></i>
					</button>
					<span class="month-label-nav"></span>
					<button class="btn btn-default btn-sm btn-next-month">
						<i class="fa fa-chevron-right"></i>
					</button>
					<button class="btn btn-default btn-sm btn-current-month">
						<i class="fa fa-dot-circle-o"></i> ${__('Heute')}
					</button>
				</div>

				<!-- Report content (print area) -->
				<div class="report-content">
					<!-- Header like PDF -->
					<div class="report-header">
						<h3>${__('Reisespesenabrechnung')}</h3>
					</div>

					<div class="report-meta">
						<div class="meta-left">
							<div class="meta-row">
								<span class="meta-label">${__('Name')}</span>
								<span class="meta-value employee-name">-</span>
							</div>
							<div class="meta-row">
								<span class="meta-label">${__('Zeitraum')}</span>
								<span class="meta-value period-label">-</span>
							</div>
						</div>
						<div class="meta-right">
							<div class="meta-row">
								<span class="meta-label">${__('Erstattung pro km')}</span>
								<span class="meta-value">
									<input type="number" class="rate-input" value="0.30" step="0.01" min="0">
									&euro;
								</span>
							</div>
							<div class="meta-row">
								<span class="meta-label">${__('Summe f\u00e4llige Erstattung')}</span>
								<span class="meta-value total-reimbursement">-</span>
							</div>
						</div>
					</div>

					<!-- Table -->
					<div class="report-table-container">
						<table class="report-table">
							<thead>
								<tr>
									<th class="col-date">${__('Datum')}</th>
									<th class="col-customer">${__('Kunden')}</th>
									<th class="col-km">${__('Kilometer')}</th>
									<th class="col-reimbursement">${__('Kilometergeldererstattung')}</th>
								</tr>
							</thead>
							<tbody class="report-tbody">
							</tbody>
							<tfoot>
								<tr class="sum-row">
									<td></td>
									<td class="text-right"><strong>${__('Summe')}</strong></td>
									<td class="col-km total-km-cell">-</td>
									<td class="col-reimbursement total-reimbursement-cell">-</td>
								</tr>
							</tfoot>
						</table>
					</div>
				</div>
			</div>

			<style>
				.travel-expenses-container {
					padding: 15px;
					max-width: 900px;
				}
				.vehicle-buttons-container {
					display: flex;
					gap: 8px;
					flex-wrap: wrap;
				}
				.btn-vehicle {
					display: inline-flex;
					align-items: center;
					gap: 6px;
					padding: 6px 14px;
					border-radius: 6px;
					font-size: 13px;
					font-weight: 500;
					cursor: pointer;
					transition: all 0.2s ease;
					border: 2px solid var(--border-color);
					background: var(--card-bg);
					color: var(--text-color);
				}
				.btn-vehicle:hover {
					border-color: var(--primary);
					background: var(--control-bg);
				}
				.btn-vehicle.active {
					background: var(--primary);
					border-color: var(--primary);
					color: #fff;
				}
				.btn-vehicle .vehicle-plate {
					font-weight: 600;
				}
				.btn-vehicle .vehicle-desc {
					font-weight: 400;
					opacity: 0.8;
				}
				.month-nav {
					display: flex;
					align-items: center;
					gap: 10px;
				}
				.month-label-nav {
					font-weight: 600;
					font-size: 15px;
					min-width: 160px;
					text-align: center;
				}

				/* Report styles (PDF-like) */
				.report-header {
					text-align: center;
					margin-bottom: 20px;
					padding-bottom: 10px;
					border-bottom: 2px solid #333;
				}
				.report-header h3 {
					margin: 0;
					font-size: 22px;
				}
				.report-meta {
					display: flex;
					justify-content: space-between;
					margin-bottom: 20px;
					gap: 40px;
				}
				.meta-left, .meta-right {
					flex: 1;
				}
				.meta-row {
					display: flex;
					align-items: center;
					margin-bottom: 6px;
					gap: 10px;
				}
				.meta-label {
					font-size: 13px;
					color: var(--text-muted);
					min-width: 100px;
				}
				.meta-right .meta-label {
					min-width: 160px;
					text-align: right;
				}
				.meta-value {
					font-weight: 600;
					font-size: 14px;
				}
				.rate-input {
					width: 70px;
					text-align: right;
					border: 1px solid var(--border-color);
					border-radius: 4px;
					padding: 2px 6px;
					font-weight: 600;
				}

				/* Table */
				.report-table {
					width: 100%;
					border-collapse: collapse;
					font-size: 13px;
				}
				.report-table thead th {
					background: var(--subtle-fg);
					border: 1px solid var(--border-color);
					padding: 8px 10px;
					font-weight: 600;
					font-size: 12px;
				}
				.report-table tbody td {
					border-left: 1px solid var(--border-color);
					border-right: 1px solid var(--border-color);
					padding: 5px 10px;
					border-bottom: 1px dotted var(--border-color);
				}
				.report-table tfoot td {
					border: 1px solid var(--border-color);
					padding: 8px 10px;
					font-weight: 600;
					background: var(--subtle-fg);
				}
				.col-date {
					width: 100px;
					white-space: nowrap;
				}
				.col-customer {
					/* flexible */
				}
				.col-km {
					width: 90px;
					text-align: right;
				}
				.col-reimbursement {
					width: 130px;
					text-align: right;
				}
				.sum-row td {
					font-size: 14px;
				}
				.empty-row td {
					color: var(--text-light);
					height: 24px;
				}

				/* Fallback rows (address instead of customer name) */
				.fallback-row {
					background: var(--yellow-50, #fff9e6);
				}
				.fallback-customer {
					color: var(--orange-500, #e67e22);
					font-style: italic;
				}
				.fallback-customer i {
					margin-right: 4px;
				}

				/* Print styles */
				@media print {
					.no-print,
					.page-head,
					.layout-side-section,
					.page-container > .page-body > .page-toolbar {
						display: none !important;
					}
					.travel-expenses-container {
						padding: 0;
						max-width: 100%;
					}
					.rate-input {
						border: none;
						background: transparent;
						-webkit-appearance: none;
						-moz-appearance: textfield;
					}
					.report-table {
						font-size: 11px;
					}
					.report-table thead th {
						background: #f0f0f0 !important;
						-webkit-print-color-adjust: exact;
						print-color-adjust: exact;
					}
					.report-table tfoot td {
						background: #f0f0f0 !important;
						-webkit-print-color-adjust: exact;
						print-color-adjust: exact;
					}
				}
			</style>
		`);

		// Bind month navigation
		this.page.main.find('.btn-prev-month').on('click', () => this.navigate_month(-1));
		this.page.main.find('.btn-next-month').on('click', () => this.navigate_month(1));
		this.page.main.find('.btn-current-month').on('click', () => {
			const now = new Date();
			this.ready = false;
			this.month_field.set_value(String(now.getMonth() + 1));
			this.year_field.set_value(String(now.getFullYear()));
			this.ready = true;
			this.refresh();
		});

		// Bind rate input change
		this.page.main.find('.rate-input').on('change', () => {
			this.rate_per_km = parseFloat(this.page.main.find('.rate-input').val()) || 0;
			this.recalculate_reimbursements();
		});
	}

	navigate_month(direction) {
		let month = parseInt(this.month_field.get_value());
		let year = parseInt(this.year_field.get_value());
		month += direction;
		if (month < 1) { month = 12; year--; }
		if (month > 12) { month = 1; year++; }
		this.ready = false;
		this.month_field.set_value(String(month));
		this.year_field.set_value(String(year));
		this.ready = true;
		this.refresh();
	}

	async load_current_employee() {
		try {
			const result = await frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_travel_expenses.yeshugo_travel_expenses.get_current_employee'
			});
			this.current_employee = result.message;
			if (this.current_employee) {
				this.employee_field.set_value(this.current_employee.name);
			}
		} catch (error) {
			console.error('Error loading employee:', error);
		}
	}

	async load_vehicles() {
		try {
			const result = await frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_travel_expenses.yeshugo_travel_expenses.get_vehicles'
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

		container.find('.btn-vehicle').on('click', (e) => {
			const btn = $(e.currentTarget);
			const vehicleId = btn.data('vehicle-id');

			if (this.selected_vehicle === vehicleId) {
				this.selected_vehicle = null;
				container.find('.btn-vehicle').removeClass('active');
			} else {
				this.selected_vehicle = vehicleId;
				container.find('.btn-vehicle').removeClass('active');
				btn.addClass('active');
			}
			this.refresh();
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

	async refresh() {
		if (!this.ready) return;

		const request_id = ++this._request_id;

		const month = this.month_field.get_value();
		const year = this.year_field.get_value();
		const monthName = this.get_month_name(parseInt(month));

		// Update nav label
		this.page.main.find('.month-label-nav').text(`${monthName} ${year}`);

		try {
			const result = await frappe.call({
				method: 'yeshugo_erpnext.yeshugo_erpnext.page.yeshugo_travel_expenses.yeshugo_travel_expenses.get_travel_expenses',
				args: {
					month: month,
					year: year,
					vehicle: this.selected_vehicle || null,
					employee: this.employee_field.get_value() || null,
					reason_filter: this.reason_field.get_value() || null
				}
			});

			// Discard stale responses
			if (request_id !== this._request_id) return;

			const data = result.message;
			this.current_data = data;

			// Update header
			this.page.main.find('.employee-name').text(data.employee_name || '-');
			this.page.main.find('.period-label').text(`${data.month_name} ${data.year}`);

			// Render table
			this.render_table(data.rows, data.total_km);
		} catch (error) {
			if (request_id !== this._request_id) return;
			console.error('Error loading data:', error);
			this.page.main.find('.report-tbody').html(
				`<tr><td colspan="4" class="text-center text-muted p-4">${__('Fehler beim Laden der Daten')}</td></tr>`
			);
		}
	}

	render_table(rows, totalKm) {
		const tbody = this.page.main.find('.report-tbody');
		let html = '';

		if (!rows || rows.length === 0) {
			html = `<tr><td colspan="4" class="text-center text-muted" style="padding: 30px;">
				${__('Keine Fahrten in diesem Zeitraum')}
			</td></tr>`;
		} else {
			for (const row of rows) {
				const dateFormatted = this.format_date(row.date);
				const reimbursement = row.km * this.rate_per_km;
				const rowClass = row.is_fallback ? 'fallback-row' : '';
				const customerHtml = row.is_fallback
					? `<span class="fallback-customer"><i class="fa fa-map-marker"></i> ${frappe.utils.escape_html(row.customer)}</span>`
					: frappe.utils.escape_html(row.customer);

				html += `
					<tr class="${rowClass}">
						<td class="col-date">${dateFormatted}</td>
						<td class="col-customer">${customerHtml}</td>
						<td class="col-km">${row.km}</td>
						<td class="col-reimbursement" data-km="${row.km}">${this.format_currency(reimbursement)}</td>
					</tr>
				`;
			}
		}

		tbody.html(html);

		// Update totals
		const totalReimbursement = totalKm * this.rate_per_km;
		this.page.main.find('.total-km-cell').text(totalKm);
		this.page.main.find('.total-reimbursement-cell').text(this.format_currency(totalReimbursement));
		this.page.main.find('.total-reimbursement').text(this.format_currency(totalReimbursement));
	}

	recalculate_reimbursements() {
		// Recalculate all reimbursement cells based on new rate
		this.page.main.find('.report-tbody .col-reimbursement').each((i, el) => {
			const km = parseFloat($(el).data('km')) || 0;
			$(el).text(this.format_currency(km * this.rate_per_km));
		});

		// Update totals
		if (this.current_data) {
			const totalReimbursement = this.current_data.total_km * this.rate_per_km;
			this.page.main.find('.total-reimbursement-cell').text(this.format_currency(totalReimbursement));
			this.page.main.find('.total-reimbursement').text(this.format_currency(totalReimbursement));
		}
	}

	format_date(dateStr) {
		if (!dateStr) return '-';
		const d = frappe.datetime.str_to_obj(dateStr);
		return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
	}

	format_currency(value) {
		return value.toLocaleString('de-DE', {
			style: 'currency',
			currency: 'EUR',
			minimumFractionDigits: 2
		});
	}

	get_month_name(month) {
		const names = [
			'', 'Januar', 'Februar', 'M\u00e4rz', 'April', 'Mai', 'Juni',
			'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
		];
		return names[month] || '';
	}
}
