"use strict";

const _ = require("lodash");
const crypto = require("crypto");
const path = require("path");
const mkdir = require("mkdirp").sync;
const DbService = require("@moleculer/database").Service;
const HashIds = require("hashids/cjs");
const ObjectID = require("mongodb").ObjectID;

const TESTING = process.env.NODE_ENV === "test";

const FIELDS = {
	id: {
		type: "string",
		primaryKey: true,
		secure: true,
		columnName: "_id"
	},
	options: { type: "object" },
	createdAt: {
		type: "number",
		readonly: true,
		onCreate: () => Date.now(),
	},
	updatedAt: {
		type: "number",
		readonly: true,
		onUpdate: () => Date.now(),
	},
	deletedAt: {
		type: "number",
		readonly: true,
		hidden: "byDefault",
		onRemove: () => Date.now(),
	}
}
const SCOPE = {
	notDeleted: { deletedAt: null }
}
const DSCOPE = ['notDeleted']


const ACTIONS = {
	create: {
		permissions: []
	},
	list: {
		permissions: []
	},

	find: {
		rest: "GET /find",
		permissions: []
	},

	count: {
		rest: "GET /count",
		permissions: []
	},

	get: {
		needEntity: true,
		permissions: []
	},

	update: {
		needEntity: true,
		permissions: []
	},

	replace: false,

	remove: {
		needEntity: true,
		permissions: []
	},
}

module.exports = function (opts = {}) {

	const hashids = new HashIds(process.env.HASHID_SALT);

	if (opts.nedb) {
		const dir = path.resolve(opts.nedb);
		mkdir(dir);
		opts = _.defaultsDeep(opts, {
			adapter: {
				type: "NeDB",
				options: {
					neDB: {
						inMemoryOnly: false,
						corruptAlertThreshold: 0.5,
						filename: path.join(dir, `${opts.collection}.db`)
					}
				}
			}
		});
	} else {
		opts = _.defaultsDeep(opts, {
			adapter: {
				type: "MongoDB",
				options: {
					uri: process.env.MONGO_URI || "mongodb://localhost/data",
					collection: opts.collection
				}
			}
		});
	}



	const schema = {
		mixins: [DbService(opts)],

		actions: {
			create: {
				permissions: [`${opts.permissions}.create`]
			},
			list: {
				permissions: [
					`${opts.permissions}.list`,
				]
			},

			find: {
				rest: "GET /find",
				permissions: [
					`${opts.permissions}.find`,
				]
			},

			count: {
				rest: "GET /count",
				permissions: [
					`${opts.permissions}.count`,
				]
			},

			get: {
				needEntity: true,
				permissions: [
					`${opts.permissions}.get`,
				]
			},

			update: {
				needEntity: true,
				permissions: [
					`${opts.permissions}.update`,
				]
			},

			replace: false,

			remove: {
				needEntity: true,
				permissions: [
					`${opts.permissions}.remove`,
				]
			},
		},

		// No need hashids encoding for NeDB at unit testing
		methods: {
			async validateHas(caller, key, query, ctx, params) {
				// Adapter init
				if (!ctx) return query;

				if (params[key]) {
					const res = await ctx.call(caller, {
						id: params[key]
					});

					if (res) {
						query[key] = params[key];
						return query;
					}
					throw new MoleculerClientError(
						`You have no right for the ${key} '${params[key]}'`,
						403,
						"ERR_NO_PERMISSION",
						{ domain: params[key] }
					);
				}
				if (ctx.action.params[key] && !ctx.action.params[key].optional) {
					throw new MoleculerClientError(`${key} is required`, 422, "VALIDATION_ERROR", [
						{ type: "required", field: key }
					]);
				}
			},
			encodeID(id) {
				if (ObjectID.isValid(id)) id = id.toString();
				return hashids.encodeHex(id);
			},

			decodeID(id) {
				return hashids.decodeHex(id);
			}
		},

		created() {
			if (!process.env.HASHID_SALT) {
				this.broker.fatal("Environment variable 'HASHID_SALT' must be configured!");
			}
		},

		async started() {

			if (_.isFunction(this.createIndexes)) {
				try {
					// Create indexes
					await this.createIndexes();
				} catch (err) {
					this.logger.error("Unable to create indexes.", err);
				}
			}

			// Seeding if the DB is empty
			if (_.isFunction(this.seedDB)) {
				const count = await this.countEntities(null, {});
				if (count == 0) {
					this.logger.info(`Seed '${opts.collection}' collection...`);
					await this.seedDB();
				}
			}
		}
	};

	return schema;
};
module.exports.db = require("@moleculer/database")
module.exports.DSCOPE = DSCOPE
module.exports.SCOPE = SCOPE
module.exports.FIELDS = FIELDS
module.exports.ACTIONS = ACTIONS