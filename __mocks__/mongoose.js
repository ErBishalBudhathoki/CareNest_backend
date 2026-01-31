const connect = jest.fn().mockResolvedValue(true);
const ObjectId = class ObjectId { constructor(id) { this.id = id; } static isValid() { return true; } toString() { return 'mock-object-id'; } };
const Mixed = class Mixed {};

class Schema {
  constructor(obj) {
    this.methods = {};
    this.statics = {};
    this.virtuals = {};
    this.obj = obj || {};
  }
  index() {}
  virtual(name) { 
    return { 
      get: (fn) => { this.virtuals[name] = fn; },
      set: (fn) => {} 
    }; 
  }
  set() {}
  pre() {}
  post() {}
}

Schema.Types = {
  ObjectId,
  Mixed,
  String: String,
  Number: Number,
  Boolean: Boolean,
  Date: Date,
  Buffer: Buffer,
  Decimal128: class Decimal128 {},
};

const model = jest.fn().mockImplementation((name, schema) => {
    return class Model {
        constructor(data) { Object.assign(this, data); }
        save() { return Promise.resolve(this); }
        static find() { return { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) }; }
        static findOne() { return { exec: jest.fn().mockResolvedValue(null) }; }
        static create(data) { return Promise.resolve(data); }
        static findById() { return { exec: jest.fn().mockResolvedValue(null) }; }
        static findByIdAndUpdate() { return { exec: jest.fn().mockResolvedValue(null) }; }
        static deleteMany() { return { exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) }; }
        static updateOne() { return { exec: jest.fn().mockResolvedValue({ nModified: 1 }) }; }
        static countDocuments() { return Promise.resolve(0); }
        static distinct() { return Promise.resolve([]); }
        static aggregate() { return Promise.resolve([]); }
        static insertMany(data) { return Promise.resolve(data); }
    };
});

module.exports = {
  connect,
  connection: {
    on: jest.fn(),
    once: jest.fn(),
    close: jest.fn(),
    readyState: 1,
  },
  Schema,
  model,
  Types: { ObjectId, Mixed },
  set: jest.fn(),
  Error: { ValidationError: class ValidationError {} },
  Promise: global.Promise,
};
