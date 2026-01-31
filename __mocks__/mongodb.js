module.exports = {
  MongoClient: class MongoClient {
    constructor() {}
    connect() { return Promise.resolve(this); }
    db() { 
        return { 
            collection: () => ({ find: () => ({ toArray: () => Promise.resolve([]) }) }),
            admin: () => ({ ping: () => Promise.resolve({ ok: 1 }) }) 
        }; 
    }
    close() {}
  },
  ObjectId: class ObjectId { constructor(id) { this.id = id; } toString() { return 'mock-object-id'; } },
  ServerApiVersion: { v1: '1' }
};
