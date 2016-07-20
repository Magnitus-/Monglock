const mongodb = require('mongodb');
const boom = require('boom');
const clone = require('clone');
Promise = require('bluebird');

function writeLock(params)
{
    if(this instanceof writeLock)
    {
        ['db', 'locktimeout', 'collection', 'timeout', 'w'].forEach((property) => {
            if(params[property])
            {
                this[property] = params[property];
            }
        });
    }
    else
    {
        return new writeLock(params);
    }
}

writeLock.prototype.locktimeout = 10000;
writeLock.prototype.collection = 'lock';
writeLock.prototype.timeout = 10000;
writeLock.prototype.w = 'majority';

writeLock.prototype.acquire = function(filter, params) 
{
    return new Promise((resolve, reject) => {
        params = params ? params : {};
        ['db', 'locktimeout', 'collection', 'timeout', 'w'].forEach((property) => {
            params[property] = params[property] ? params[property] : this[property];
        });
    
        var now = Date.now();
        var collection = params.db.collection(params.collection);
        var or = [{'lock': {'$exists': false}}, {'lock.active': false}, {'lock.timestamp': {'$lte': now-params.locktimeout}}];
        var augmentedFilter = clone(filter);

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

        collection.updateOne(augmentedFilter, {'$set': {'lock': {'active': true, 'timestamp': now}}}, {'w': params.w, 'wtimeout': params.timeout}).then((result) => {
            if(result.matchedCount == 1)
            {
                resolve(now);
            }
            else
            {
                collection.find(filter).maxTimeMS(params.timeout).limit(1).toArray().then((value) => {
                    value = value[0];
                    if(value)
                    {
                        reject(boom.conflict('LockAlreadyTaken'));
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

writeLock.prototype.release = function(filter, params) 
{
    return new Promise((resolve, reject) => {
        params = params ? params : {};
        ['db', 'locktimeout', 'collection', 'timeout', 'w'].forEach((property) => {
            params[property] = params[property] ? params[property] : this[property];
        });
    
        var collection = params.db.collection(params.collection);
        var augmentedFilter = clone(filter);
        if(params.timestamp)
        {
            augmentedFilter['lock.timestamp'] = params.timestamp;
        }

        collection.updateOne(augmentedFilter, {'$set': {'lock.active': false}}, {'w': params.w, 'wtimeout': params.timeout}).then((result) => {
            if(result.matchedCount == 1)
            {
                resolve();
            }
            else
            {
                if(params.timestamp)
                {
                    collection.find(filter).maxTimeMS(params.timeout).limit(1).toArray().then((value) => {
                        value = value[0];
                        if(value)
                        {
                            reject(boom.conflict('LockWasReacquired'));
                        }
                        else
                        {
                            reject(boom.notFound('RessourceNotFound'));
                        }
                    }).catch((err) => {
                        throw err;
                    });
                }
                else
                {
                    reject(boom.notFound('RessourceNotFound'));
                }
            }
        }).catch((err) => {
            reject(boom.badImplementation('DbError'));
        });
    });
}

module.exports = writeLock;