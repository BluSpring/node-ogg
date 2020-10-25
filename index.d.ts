declare module 'ogg' {
    import {Readable, Writable, WritableOptions, ReadableOptions} from 'stream';

    export class Encoder extends Readable {
        constructor(opts?: ReadableOptions);
    }

    export class Decoder extends Writable {
        constructor(opts?: WritableOptions)
    }
}