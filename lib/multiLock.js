const mongodb = require('mongodb');
const boom = require('boom');
const clone = require('clone');
Promise = require('bluebird');

//cooperative, assertive
function multiLock(params)
{
    if(this instanceof multiLock)
    {
        ['db', 'locktimeouts', 'lockRelationships', 'collection', 'timeout', 'w'].forEach((property) => {
            if(params[property])
            {
                this[property] = params[property];
            }
        });
    }
    else
    {
        return new writeLock(multiLock);
    }
}

multiLock.prototype.collection = 'lock';
multiLock.prototype.timeout = 10000;
multiLock.prototype.w = 'majority';

function augmentFilter(filter, params, lockType)
{
    var augmentedFilter = clone(filter);
    var or = null;
    
    if(params.lockRelationships[params.tag][lockType] && params.lockRelationships[params.tag][lockType].length > 0)
    {
        or = [{'lock': {'$exists': false}}, {'$and': []}];
        var now = params.lock ? params.lock.timestamp : Date.now();
        var id = params.lock ? params.lock.id : new mongodb.ObjectID();
        params.lockRelationships[params.tag][lockType].forEach((tag) => {
            //would negation of "or" be better (faster/more legible)?
            or['$and'].push({'$or'[{'lock.'+tag+".timestamp": {'$lte': now - params.locktimeouts[tag]}}, {'lock.'+tag: {'$size': 0}}, {'lock.'+tag: {'$exists': false}}]);
        });
    }
    
    if(or)
    {
        if(!augmentedFilter['$or'])
        {
            augmentedFilter['$or'] = or;
        }
        else
        {
            if(!augmentedFilter['$and'])
            {
                augmentedFilter['$and'] = [];
            }
            augmentedFilter['$and'].push(augmentedFilter['$or']);
            delete augmentedFilter['$or'];
            augmentedFilter['$and'].push({'$or': or});
        }
    }
    
    return augmentedFilter;
}

multiLock.prototype.acquire = function(filter, params) 
{
    return new Promise((resolve, reject) => {
        params = params ? params : {};
        ['db', 'locktimeouts', 'lockRelationships', 'collection', 'timeout', 'w', 'tag', 'lock'].forEach((property) => {
            params[property] = params[property] ? params[property] : this[property];
        });
        

        var collection = params.db.collection(params.collection);
        var augmentedFilter = null;
        
        var or = null;
        if(params.lock)
        {   //Lock already acquired, make sure locks we are assertive on are free
            augmentedFilter = augmentFilter(filter, params, 'assertive');
        }
        else
        {    //Lock not acquired, make sure locks we are cooperative on are free
            augmentedFilter = augmentFilter(filter, params, 'cooperative');
        }
        
        if(params.lock)
        {    //Lock already acquired so no update, a simple find to ensure locks we are assertive on are free will suffice
            collection.findOne(augmentedFilter).then((value) => {
                if(value)
                {
                    resolve({'timestamp': now, 'id': id});
                }
                else
                {
                    var assertiveLockError = boom.conflict('AssertiveLock');
                    assertiveLockError.output.payload.lock = {'timestamp': now, 'id': id};
                    reject(assertiveLockError);
                }
            }).catch((err) => {
                reject(boom.badImplementation('DbError'));
            });
        }
        else
        {    //acquire lock while checking against lock we are cooperative on, then check on locks we are assertive on
            collection.updateOne(augmentedFilter, {'$push': {'lock.'+params.tag: {'timestamp': now, 'id': id}}}, {'w': params.w, 'wtimeout': params.timeout}).then((result) => {
                if(result.matchedCount == 1)
                {
                    augmentedFilter = augmentFilter(filter, params, 'assertive');
                    collection.findOne(augmentedFilter, {'maxTimeMS': params.timeout}).then((value) => {
                        if(value)
                        {
                            resolve({'timestamp': now, 'id': id});
                        }
                        else
                        {
                            var assertiveLockError = boom.conflict('AssertiveLock');
                            assertiveLockError.output.payload.lock = {'timestamp': now, 'id': id};
                            reject(assertiveLockError);
                        }
                    });
                }
                else
                {
                    collection.findOne(filter).then((value) => {
                        if(value)
                        {
                            reject(boom.conflict('CooperativeLock'));
                        }
                        else
                        {
                            reject(boom.notFound('RessourceNotFound'));
                        }
                    }).catch((err) => {
                        throw err;
                    });
                }
            }).catch((err) => {
                reject(boom.badImplementation('DbError'));
            });
        }
    });
}

multiLock.prototype.release = function(filter, params) 
{
    return new Promise((resolve, reject) => {
        params = params ? params : {};
        ['db', 'lock', 'collection', 'timeout', 'w', 'tag'].forEach((property) => {
            params[property] = params[property] ? params[property] : this[property];
        });
        
        var collection = params.db.collection(params.collection);
        var augmentedFilter = clone(filter);
        augmentedFilter['lock.'+params.tag+',id'] = params.lock.id;
        collection.updateOne(augmentedFilter, {'$pull': {'lock.'+params.tag: {'id': params.lock.id}}}, {'w': params.w, 'wtimeout': params.timeout}).then((result) => {
            if(result.matchedCount == 1)
            {
                resolve();
            }
            else
            {
                collection.findOne(filter, {'maxTimeMS': params.timeout}).then((value) => {
                    if(value)
                    {
                        reject(boom.conflict('LockNotFound'));
                    }
                    else
                    {
                        reject(boom.notFound('RessourceNotFound'));
                    }
                }).catch((err) => {
                    throw err;
                });
            }
        }).catch((err) => {
            reject(boom.badImplementation('DbError'));
        });
    });
}

module.exports = multiLock;