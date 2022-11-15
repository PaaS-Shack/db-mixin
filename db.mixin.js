"use strict";

const _ = require("lodash");
const crypto = require("crypto");
const path = require("path");
const mkdir = require("mkdirp").sync;
const DbService = require("@moleculer/database").Service;
const HashIds = require("hashids/cjs");
const ObjectID = require("mongodb").ObjectID;

const TESTING = process.env.NODE_ENV === "test";

module.exports = function (opts = {}) {
	if (!process.env.TOKEN_SALT && (TESTING || process.env.TEST_E2E)) {
		process.env.HASHID_SALT = crypto.randomBytes(32).toString("hex");
	}

	const hashids = new HashIds(process.env.HASHID_SALT);

	if ((TESTING && !process.env.TEST_INT) || process.env.ONLY_GENERATE) {
		opts = _.defaultsDeep(opts, {
			adapter: "NeDB"
		});
	} else {
		if (process.env.NEDB_FOLDER || opts.nedb) {
			const dir = path.resolve(process.env.NEDB_FOLDER || opts.nedb);
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
	}


	const schema = {
		mixins: [DbService(opts)],

		settings: {

			fields: {
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
			},

			scopes: {
				notDeleted: { deletedAt: null }
			},

			defaultScopes: ["notDeleted"]
		},

		actions: {
			
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
			/* istanbul ignore next */
			if (!TESTING) {
				try {
					// Create indexes
					await this.createIndexes();
				} catch (err) {
					this.logger.error("Unable to create indexes.", err);
				}
			}

			if (process.env.TEST_E2E || process.env.TEST_INT) {
				// Clean collection
				this.logger.info(`Clear '${opts.collection}' collection before tests...`);
				await this.clearEntities();
			}

			// Seeding if the DB is empty
			const count = await this.countEntities(null, {});
			if (count == 0 && _.isFunction(this.seedDB)) {
				this.logger.info(`Seed '${opts.collection}' collection...`);
				await this.seedDB();
			}
		}
	};

	return schema;
};
module.exports.db = require("@moleculer/database")