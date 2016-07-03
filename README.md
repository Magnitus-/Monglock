#Purpose

Mongodb locking library that operates on arbitrary documents in arbitrary collections.

It returns promises and errors are generated using the boom library. 

Behavior when a lock cannot be acquired is to return an error and let the caller determine how to handle retrying.

##Note About Locks

As a rule of thumb, you should probably use locks as sparingly as possible and make locks as specific as possible to maximize concurrency in your application.

If possible, try to think about how you can structure your collection and data-access pattern to avoid conflict or if your use case allows for it and it rarely happens, allow conflicting access, detect that it has occured and recover gracefully from it.

As an extreme example, you could use this library to secure a lock on each collection before accessing it (if you create a lock collection containing documents representing various collections to acquire a lock on), but if you end up doing that, you'll kill all the paralellism in your application and you may as well use an SQL database like PostgreSQL and take advantage of its transaction capabilities.

##writeLock

The write lock is useful when you only need one type of lock that you need to grab (ex: you want to prevent conflicting writes and there aren't any types of writes that can occur concurrently).

###Methods

###Usage

##multiLock

The multi lock is useful when you have various types of locks (ex: read and write locks or two types of write locks, one for atomic writes and one for non-atomic writes) and you want to fine tune the locking behavior.

###Methods

###Usage

