const mongodb = require('mongodb');
const clone = require('clone');
Promise = require('bluebird');

const utils = require('./utils');

function writeLock(params)
{
    if(this instanceof writeLock)
    {
        ['locktimeout', 'collection', 'timeout', 'w', 'boom'].forEach((property) => {
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
writeLock.prototype.timeout = 10000;
writeLock.prototype.w = 'majority';

writeLock.prototype.acquire = function(filter, params)
{
    return new Promise((resolve, reject) => {
        params = params ? params : {};
        ['locktimeout', 'collection', 'timeout', 'w', 'boom'].forEach((property) => {
            params[property] = params[property] ? params[property] : this[property];
        });

        var now = Date.now();
        var collection = params.collection;
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
                        reject(utils.getError('conflict', 'LockAlreadyTaken', params.boom));
                    }
                    else
                    {
                        reject(utils.getError('notFound', 'RessourceNotFound', params.boom));
                    }
                }).catch((err) => {
                    throw err;
                });
            }
        }).catch((err) => {
            reject(utils.getError('badImplementation', 'DbError', params.boom));
        });
    });
}

writeLock.prototype.release = function(filter, params)
{
    return new Promise((resolve, reject) => {
        params = params ? params : {};
        ['locktimeout', 'collection', 'timeout', 'w', 'boom'].forEach((property) => {
            params[property] = params[property] ? params[property] : this[property];
        });

        var collection = params.collection;
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
                            reject(utils.getError('conflict', 'LockWasReacquired', params.boom));
                        }
                        else
                        {
                            reject(utils.getError('notFound', 'RessourceNotFound', params.boom));
                        }
                    }).catch((err) => {
                        throw err;
                    });
                }
                else
                {
                    reject(utils.getError('notFound', 'RessourceNotFound', params.boom));
                }
            }
        }).catch((err) => {
            reject(utils.getError('badImplementation', 'DbError', params.boom));
        });
    });
}

module.exports = writeLock;
