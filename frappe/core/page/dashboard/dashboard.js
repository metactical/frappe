// Copyright (c) 2019, Frappe Technologies Pvt. Ltd. and Contributors
// MIT License. See license.txt

frappe.provide("frappe.dashboard_chart_sources");

frappe.pages['dashboard'].on_page_load = function(wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Dashboard"),
		single_column: true
	});

	frappe.dashboard = new Dashboard(wrapper);
	$(wrapper).bind('show', function() {
		frappe.dashboard.show();
	});
};

class Dashboard {
	constructor(wrapper) {
		this.wrapper = $(wrapper);
		$(`<div class="dashboard">
			<div class="dashboard-graph" class="row"></div>
		</div>`).appendTo(this.wrapper.find(".page-content").empty());
		this.container = this.wrapper.find(".dashboard-graph");
		this.page = wrapper.page;
	}

	show() {
		this.route = frappe.get_route();
		const current_dashboard_name = this.route.slice(-1)[0];

		if(this.dashboard_name !== current_dashboard_name) {
			this.dashboard_name = current_dashboard_name;
			this.page.set_title(this.dashboard_name);
			this.refresh();
		}
		this.charts = {};
	}

	refresh() {
		this.get_dashboard_doc().then((doc) => {
			this.dashboard_doc = doc;
			this.charts = this.dashboard_doc.charts;

			this.charts.map((chart_doc) => {
				let chart_container = $("<div><div>");
				chart_container.appendTo(this.container);

				let dashboard_chart = new DashboardChart(chart_doc, chart_container);
				dashboard_chart.show();
			});
		});
	}

	get_dashboard_doc() {
		return frappe.model.with_doc('Dashboard', this.dashboard_name);
	}
}

class DashboardChart {
	constructor(chart_doc, chart_container) {
		this.chart_doc = chart_doc;
		this.container = chart_container;
	}

	show() {
		this.get_settings().then(() => {
			this.prepare_chart_object();
			this.prepare_container();
			this.prepare_chart_actions();
			this.fetch(this.filters).then((data) => {
				this.update_last_synced();
				this.data = data;
				this.render();
			});
		});
	}

	prepare_container() {
		const column_width_map = {
			"Half": "6",
			"Full": "12",
		};
		let columns = column_width_map[this.chart_doc.width];
		this.chart_container = $(`<div class="col-sm-${columns} chart-column-container">
			<div class="chart-wrapper"></div>
		</div>`);
		this.chart_container.appendTo(this.container);

		let last_synced_text = $(`<span class="text-muted last-synced-text"></span>`);
		last_synced_text.prependTo(this.chart_container);
	}

	prepare_chart_actions() {
		let actions = [
			{
				label: __("Set Filters"),
				action: "set-filters",
				handler: this.create_set_filters_dialog.bind(this)
			},
			{
				label: __("Force Refresh"),
				action: "force-refresh",
				handler: () => {
					this.fetch(this.filters, true).then(data => {
						this.update_chart_object();
						this.data = data;
						this.render();
					});
				}
			}
		];

		this.chart_actions = $(`<div class="chart-actions btn-group dropdown pull-right">
			<a class="dropdown-toggle" data-toggle="dropdown"
				aria-haspopup="true" aria-expanded="false"> <button class="btn btn-default btn-xs"><span class="caret"></span></button>
			</a>
			<ul class="dropdown-menu" style="max-height: 300px; overflow-y: auto;">
				${actions.map(action => `<li><a data-action="${action.action}">${action.label}</a></li>`).join('')}
			</ul>
		</div>
		`);

		this.chart_actions.find("a[data-action]").each((i, o) => {
			const action = o.dataset.action;
			$(o).click(actions.find(a => a.action === action));
		});
		this.chart_actions.prependTo(this.chart_container);
	}

	fetch(filters, refresh=false) {
		return frappe.xcall(
			this.settings.method_path,
			{
				chart_name: this.chart_doc.name,
				filters: filters,
				refresh: refresh,
			}
		);
	}

	render() {
		const chart_type_map = {
			"Line": "line",
			"Bar": "bar",
		};
		let chart_args = {
			title: this.chart_doc.chart_name,
			data: this.data,
			type: chart_type_map[this.chart_doc.type],
			colors: [this.chart_doc.color || "light-blue"],
			axisOptions: {
				xIsSeries: this.settings.is_time_series
			},
		};
		if(!this.chart) {
			this.chart = new Chart(this.chart_container.find(".chart-wrapper")[0], chart_args);
		} else {
			this.chart.update(this.data);
		}
	}

	update_last_synced() {
		let last_synced_text = __("Last synced {0}", [comment_when(this.chart_doc.last_synced_on)]);
		this.container.find(".last-synced-text").html(last_synced_text);
	}

	update_chart_object() {
		frappe.db.get_doc("Dashboard Chart", this.chart_doc.name).then(doc => {
			this.chart_doc = doc;
			this.prepare_chart_object();
			this.update_last_synced();
		});
	}

	prepare_chart_object() {
		this.filters = JSON.parse(this.chart_doc.filters_json || '{}');
	}

	get_settings() {
		if (frappe.dashboard_chart_sources && frappe.dashboard_chart_sources[this.chart_doc.source]) {
			return this._load_script;
		}
		this._load_script = new Promise(resolve => frappe.call({
			method: 'frappe.core.page.dashboard.dashboard.get_script',
			args: {
				source_name: this.chart_doc.source
			},
			callback: result => {
				frappe.dom.eval(result.message.script || '');
				this.settings = frappe.dashboard_chart_sources[this.chart_doc.source];
				resolve();
			}
		}));
		return this._load_script;
	}

	create_set_filters_dialog() {
		const d = new frappe.ui.Dialog({
			title: __('Set Filters'),
			fields: this.settings.filters
		});
		d.set_values(this.filters);
		d.show();

		const set_filters = () => {
			const values = d.get_values();
			if (!Object.entries(this.filters).map(e => values[e[0]] === e[1]).every(Boolean)) {
				frappe.db.set_value("Dashboard Chart", this.chart_doc.name, "filters_json", JSON.stringify(values)).then(() => {
					this.fetch(values, true).then(data => {
						this.update_chart_object();
						this.data = data;
						this.render();
					});
				});
			}
			d.hide();
		};

		this.settings.filters.map(field => field.onchange = e => {
			if(e) {
				d.set_primary_action(__('Save Filters'), set_filters);
			}
		});
	}
}