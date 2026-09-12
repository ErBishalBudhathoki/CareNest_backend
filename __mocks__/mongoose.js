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

const createQueryMock = (defaultVal = null) => {
    const q = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnValue(Promise.resolve(defaultVal)),
        exec: jest.fn().mockResolvedValue(defaultVal),
        then: function(resolve, reject) { return Promise.resolve(defaultVal).then(resolve, reject); },
    };
    return q;
};

const model = jest.fn().mockImplementation((name, schema) => {
    class Model {
        constructor(data) { Object.assign(this, data); }
        save() { return Promise.resolve(this); }
    }
    Model.find = jest.fn(() => createQueryMock([]));
    Model.findOne = jest.fn(() => createQueryMock(null));
    Model.create = jest.fn((data) => Promise.resolve(data));
    Model.findById = jest.fn(() => createQueryMock(null));
    Model.findByIdAndUpdate = jest.fn(() => createQueryMock(null));
    Model.findOneAndUpdate = jest.fn(() => createQueryMock(null));
    Model.deleteMany = jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) }));
    Model.updateOne = jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ nModified: 1 }) }));
    Model.countDocuments = jest.fn(() => Promise.resolve(0));
    Model.distinct = jest.fn(() => Promise.resolve([]));
    Model.aggregate = jest.fn(() => Promise.resolve([]));
    Model.insertMany = jest.fn((data) => Promise.resolve(data));
    return Model;
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
