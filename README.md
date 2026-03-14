<div align="center">

<img src=".github/yeshugo-logo.webp" alt="YesHugo ERPNext Logo" height="80">

<h1>YesHugo ERPNext</h1>

**Vehicle tracking and trip management for ERPNext**

</div>

> **Note:** This is a third-party community app developed by [Glück's IT Services GmbH](https://gluecks-it.de). It is not affiliated with, maintained, or endorsed by YesHugo or the ERPNext/Frappe team.

## What is YesHugo?

[YesHugo](https://yeshugo.com) is a fleet management platform from the Netherlands that tracks vehicles via a plug-and-play OBD-II GPS tracker or direct manufacturer integration. It covers trip logging, driving behavior analysis, fuel costs, CO2 tracking, maintenance alerts, and EV charge session monitoring.

Supported brands include Tesla, Audi, BMW, Mercedes, Volkswagen, Skoda, Peugeot, KIA, and 13+ others — either through the OBD-II dongle or native vehicle API coupling.

## YesHugo ERPNext

This app brings YesHugo data into your ERPNext instance. It syncs vehicles, trips, and charge sessions automatically and lets you create timesheets directly from trip data. You need a valid YesHugo account and API credentials to use this app.

### Key Features

- **Vehicle Sync**: Import and update vehicle data from YesHugo including odometer, fuel level, and location. Assign vehicles to employees for automatic filtering.
- **Trip Management**: Sync trips with distance, duration, route segments, and stop times. Classify trips as business or private.
- **Charge Session Tracking**: Track EV charging sessions including energy consumption, charge type, and SOC percentages.
- **Timesheet Integration**: Create timesheet entries from trips with a single click. Configurable activity types and automatic employee mapping.
- **Trip Overview Page**: A dedicated page for reviewing, filtering, and managing trips by vehicle and date range with weekly navigation.
- **Travel Expenses Page**: Monthly travel expense report with kilometer reimbursement calculation, grouped by customer/destination. Printable layout.
- **Home Location Detection**: Automatically detect trips starting or ending at a configurable home location.
- **Scheduled Sync**: Daily background sync keeps your data up to date without manual intervention.

### Roles & Permissions

| Role | Access |
|---|---|
| **System Manager** | Full access to all vehicles, trips, and settings |
| **Fleet Manager** | See all vehicles and trips across all employees |
| **Pool Vehicle User** | See pool vehicles (no employee assigned) + own vehicle |
| **Employee** | See only own assigned vehicle |

Vehicles can be assigned to employees via the **Employee** field on the YesHugo Vehicle doctype. Unassigned vehicles are considered pool vehicles and only visible to users with the **Fleet Manager** or **Pool Vehicle User** role.

### Under the Hood

- [**Frappe Framework**](https://github.com/frappe/frappe): A full-stack web application framework written in Python and JavaScript.
- [**ERPNext**](https://github.com/frappe/erpnext): Open source ERP with Timesheet, Employee, and Activity Type integration.
- [**YesHugo API**](https://yeshugo.com): Vehicle tracking platform providing trip, vehicle, and charging data.

## Getting Started

### Prerequisites

- A running ERPNext instance (v15+)
- A [YesHugo](https://yeshugo.com) account with API access
- Your **X-Token** (persistent token, request via YesHugo support) or **JWT Token** (temporary, needs periodic renewal)

### Installation

1. [Set up Bench](https://docs.frappe.io/framework/user/en/installation) and keep `bench start` running.
2. In the `frappe-bench` directory, run:

```bash
bench get-app yeshugo_erpnext https://github.com/gluecks-it/yeshugo_erpnext.git
bench --site your-site.localhost install-app yeshugo_erpnext
```

### Configuration

1. Go to **YesHugo Settings** and enter your API credentials.
   - **X-Token** (recommended): A persistent token that does not expire. Contact YesHugo support to request one.
   - **JWT Token**: A temporary token from the YesHugo dashboard. Needs to be refreshed regularly.
2. Click **Test Connection** to verify the setup.
3. Configure your home location and default activity type.
4. Run **Sync Now** to pull initial data or wait for the daily scheduled sync.


## License

MIT
