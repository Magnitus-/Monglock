#Purpose

Mongodb locking library that operates on arbitrary documents in arbitrary collections.

It returns promises and errors are generated using the boom library. 

Behavior when a lock cannot be acquired is to return an error and let the caller determine how to handle retrying.

More documentation soon.
