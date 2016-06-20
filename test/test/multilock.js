const mongoDB = require('mongodb');
Promise = require('bluebird');

const monglock = require('../lib/index');

var db = null;

exports.main = {
    'setUp': function(callback) {
        mongoDB.MongoClient.connect("mongodb://mongodb:27017/test", {native_parser:true}, (err, database) => {
            db = database;
            const testCol = db.collection('test');
            testCol.remove({}).then(() => {
                callback();
            });
        });
    },
    'tearDown': function(callback) {
        const testCol = db.collection('test');
        testCol.remove({}).then(() => {
            db.close();
            callback();
        });
    },
    'cooperative_locks': function(test) {
        test.expect(0);
        var aLock = null;
        var bLock = null;
        var testCol = db.collection('test');
        testCol.insertOne({'_id': 1}).then(() => {
            var multiLock = monglock.multiLock({
                db: db,
                locktimeouts: {
                    a: 1000,
                    b: 1000
                },
                lockRelationships: {
                    a: {'cooperative': ['b']},
                    b: {'cooperative': ['a']}
                },
                collection: 'test',
                timeout: 1000,
                w: 1
            });
            multiLock.acquire({'_id': 1}, {tag: 'a'}).then((lock) => {
                aLock = lock;
            }).then(() => {
                return multiLock.acquire({'_id': 1}, {tag: 'b'}).catch((err) => {
                    console.log(err);
                });
            });
        }).catch((err) => {
            console.log(err);
        }).finally(() => {
            test.done();
        });
        
    },
    'aggressive_locks': function(test) {
        test.expect(0);
        test.done();
    },
    'lock_timeouts': function(test) {
        test.expect(0);
        test.done();
    },
    'misuse': function(test) {
        test.expect(0);
        test.done();
    }
}
