/** Sample specs for /genui-demo and the tests, written the way a model would. */
export const EXAMPLES: Record<string, Record<string, unknown>> = {
	dashboard: {
		title: "API latency · last 12 hours",
		view: [
			{
				row: [
					{ stat: "p50", value: 84, unit: " ms", delta: -6, deltaUnit: "%", invert: true },
					{ stat: "p99", value: 912, unit: " ms", delta: 31, deltaUnit: "%", invert: true },
					{ stat: "Error rate", value: 0.42, format: "percent", delta: 0.1, invert: true, caption: "SLO 1%" },
				],
			},
			{
				line: {
					p50: [80, 82, 79, 85, 90, 88, 84, 83, 86, 81, 84, 84],
					p99: [610, 640, 590, 720, 980, 1210, 940, 870, 905, 860, 890, 912],
				},
				labels: ["00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00", "08:00", "09:00", "10:00", "11:00"],
				height: 8,
				unit: "ms",
			},
			{
				row: [
					{ box: [{ bar: { "/search": 1830, "/checkout": 1210, "/cart": 640, "/login": 380 }, unit: " ms", sort: "desc" }], title: "Slowest routes (p99)" },
					{ box: [{ progress: 71, label: "CPU" }, { progress: 48, label: "Memory" }, { progress: 42, label: "Errors", tone: "warning" }], title: "Budget", gap: 0 },
				],
			},
		],
	},

	interest: {
		title: "Compound interest",
		state: { principal: 10000, rate: 6, years: 20, monthly: 200 },
		calc: {
			balance:
				"range(years + 1).map(y => { const r = rate / 1200, n = y * 12; return round(principal * (1 + r) ** n + (r ? monthly * ((1 + r) ** n - 1) / r : monthly * n)); })",
			final: "balance[years]",
			contributed: "principal + monthly * 12 * years",
		},
		view: [
			{ slider: "principal", label: "Start", max: 100000, step: 1000, format: "currency" },
			{ slider: "monthly", label: "Monthly", max: 2000, step: 50, format: "currency" },
			{ slider: "rate", label: "Rate", max: 15, step: 0.5, format: "percent" },
			{ slider: "years", label: "Years", min: 1, max: 40 },
			{
				row: [
					{ stat: "Final balance", value: "=final", format: "currency", tone: "accent" },
					{ stat: "You put in", value: "=contributed", format: "currency" },
					{ stat: "Interest earned", value: "=final - contributed", format: "currency", tone: "success" },
				],
			},
			{ line: "=balance", labels: "=range(years + 1).map(y => 'y' + y)", height: 8, format: "currency" },
		],
	},

	deploy: {
		title: "Deploy release 2.14.0",
		state: { notes: "" },
		view: [
			{
				select: "env",
				label: "Environment",
				options: [
					{ label: "staging", description: "auto-promotes nightly" },
					{ label: "production", description: "requires approval" },
					{ label: "canary", description: "5% of traffic" },
				],
			},
			{ multi: "services", label: "Services", options: ["api", "web", "worker", "scheduler"] },
			{ toggle: "migrate", label: "Run database migrations" },
			{ input: "notes", label: "Release note", placeholder: "optional" },
			{ buttons: [{ label: "Deploy", action: "deploy" }, { label: "Dry run", action: "dry-run" }, { label: "Cancel", action: "cancel", tone: "muted" }] },
		],
	},

	pick: {
		title: "Which PR should I review first?",
		view: [
			{
				table: [
					{ id: 4812, title: "Retry webhook deliveries with backoff", author: "maya", diff: "+212 −40", age: "2d" },
					{ id: 4809, title: "Drop legacy session cookies", author: "jon", diff: "+18 −301", age: "3d" },
					{ id: 4807, title: "Cache pricing rules per tenant", author: "ari", diff: "+96 −12", age: "4d" },
					{ id: 4790, title: "Upgrade to Postgres 17 driver", author: "sam", diff: "+44 −44", age: "1w", tone: "warning" },
				],
				columns: ["id", "title", "author", { label: "+/-", key: "diff", align: "right" }, "age"],
				bind: "pr",
				valueKey: "id",
			},
		],
	},

	architecture: {
		title: "How a request reaches the database",
		view: [
			{ flow: ["Browser", { label: "CDN", note: "cache 60s" }, { label: "API", note: "auth + rate limit" }, { label: "Worker", note: "queue" }, "Postgres"], active: 2 },
			{
				row: [
					{ tree: { "src/": { "api/": { "routes.ts": null, "middleware.ts": null }, "worker/": { "jobs.ts": null }, "db/": { "schema.sql": null, "pool.ts": null } } } },
					{ note: "middleware.ts runs on every request; the rate limiter does a Redis round trip there.", title: "Hot path", tone: "warning" },
				],
			},
		],
	},

	activity: {
		title: "Commits by weekday and hour",
		view: [
			{
				heatmap: [
					[2, 9, 6, 11, 14, 8, 3, 1],
					[4, 12, 9, 15, 13, 10, 2, 0],
					[3, 10, 7, 14, 16, 9, 4, 2],
					[5, 13, 8, 12, 11, 7, 3, 1],
					[2, 8, 5, 9, 6, 3, 1, 0],
					[0, 1, 2, 3, 2, 1, 4, 5],
					[0, 0, 1, 1, 2, 3, 6, 4],
				],
				rows: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
				cols: ["8", "10", "12", "14", "16", "18", "20", "22"],
			},
			{ bar: { Mon: 54, Tue: 65, Wed: 65, Thu: 60, Fri: 34, Sat: 18, Sun: 17 }, vertical: true, height: 6, values: true },
		],
	},

	explore: {
		title: "Bundle size by route",
		state: { metric: "gzip" },
		calc: {
			k: "metric === 'gzip' ? 0.31 : metric === 'brotli' ? 0.26 : 1",
			sizes: "({ '/': round(412 * k), '/search': round(388 * k), '/checkout': round(296 * k), '/account': round(214 * k), '/admin': round(902 * k) })",
		},
		view: [
			{
				tabs: {
					Chart: [{ select: "metric", inline: true, options: ["raw", "gzip", "brotli"] }, { bar: "=sizes", unit: " kB", sort: "desc" }],
					Table: [{ kv: "=sizes", unit: " kB" }, { text: "Total: {{sum(Object.values(sizes))}} kB", style: "bold" }],
					Notes: [{ md: "- /admin ships the chart library eagerly\n- /search and / share 70% of their vendor chunk" }],
				},
			},
		],
	},
};

export const EXAMPLE_NAMES = Object.keys(EXAMPLES);
