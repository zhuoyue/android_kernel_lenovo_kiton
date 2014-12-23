#!/usr/local/bin/node

var fs = require('fs'),
    path = require('path'),
    zlib = require('zlib');

function padLeft( number, width, filler ) {
    filler = filler || ' ';
    width -= number.toString().length;
    if ( width > 0 )
        return new Array( width + (/\./.test( number ) ? 2 : 1) ).join( filler ) + number;
    return number + ""; // always return a string
}

function help() {
    console.log("Usage:");
    console.log(process.argv[1] + " <tree|list|extract|create|modify> [args]");
    console.log("Simple initramfs(gzipped cpio newc archive) manipulation script.")
    console.log(" Functions:")
    console.log("  tree <image file> [max dump level]");
    console.log("  list <image file> [target path]");
    console.log("  cat <image file> <target file>");
    console.log("  create <input dir> <output file>");
    console.log("  modify <image file> [commands]");
    console.log("   command syntax:");
    console.log("    mkdir <archive path>");
    console.log("    put <local file> <archive file>");
    console.log("    link <archive source file> <archive file>");
    console.log("    remove <archive file/directory>");
}

// Ugly implementation to suite certain needs
// For example only '.' is considered valid root, etc.
function Tree(data) {    
    this._$tree = { 
        subdirs: { },
        files: { }, 
        nodeinfo: undefined
    };
    if(Array.isArray(data)) data.forEach(function(e) { this.addEntry(e); }, this);
    else if(Buffer.isBuffer(data)) this.fromBuffer(data);
}
Tree.prototype.validate = function() {
    function walkTree(node, cb) {
        cb(node.nodeinfo);
        for(var e in node.subdirs)
            walkTree(node.subdirs[e], cb);
        for(var e in node.files)
            cb(node.files[e]);
    }
    var res = true;
    walkTree(this._$tree, function(stats) {
        if(res && (stats === undefined))
            res = false;
    });
    return res;
}
Tree.prototype.fromBuffer = function(newc_data) {
    for(var i = 0; i < newc_data.length; ) {
        if((i % 4) !== 0) i += 4 - (i % 4);
        if(newc_data.slice(i, i + 6).toString() !== '070701') {
            if(newc_data[i] !== 0) {
                console.log('Error extracting file entry from initramfs.');
                break;
            } else i++;
        }
        var file_entry = new fs.Stats;

        file_entry.ino = parseInt('0x' + newc_data.slice(i + 6, i + 14).toString());          //File inode number
        file_entry.mode = parseInt('0x' + newc_data.slice(i + 14, i + 22).toString());        //File mode and permissions
        file_entry.uid = parseInt('0x' + newc_data.slice(i + 22, i + 30).toString());         //File uid
        file_entry.gid = parseInt('0x' + newc_data.slice(i + 30, i + 38).toString());         //File gid
        file_entry.nlink = parseInt('0x' + newc_data.slice(i + 38, i + 46).toString());       //Number of links
        file_entry.mtime = parseInt('0x' + newc_data.slice(i + 46, i + 54).toString());       //Modification time
        file_entry.size = parseInt('0x' + newc_data.slice(i + 54, i + 62).toString());        //Size of data field
        file_entry.maj = parseInt('0x' + newc_data.slice(i + 62, i + 70).toString());         //Major part of file device number
        file_entry.min = parseInt('0x' + newc_data.slice(i + 70, i + 78).toString());         //Minor part of file device number
        file_entry.rmaj = parseInt('0x' + newc_data.slice(i + 78, i + 86).toString());        //Major part of device node reference
        file_entry.rmin = parseInt('0x' + newc_data.slice(i + 86, i + 94).toString());        //Minor part of device node reference
        file_entry.namesize = parseInt('0x' + newc_data.slice(i + 94, i + 102).toString());   //Length of filename, including final \0
        file_entry.chksum = parseInt('0x' + newc_data.slice(i + 102, i + 110).toString());    //zero
        
        file_entry.dev = (file_entry.maj << 8) + file_entry.min;
        file_entry.rdev = (file_entry.rmaj << 8) + file_entry.rmin;

        file_entry.name = newc_data.slice(i + 110, i + 110 + file_entry.namesize).toString();
        file_entry.name = file_entry.name.replace(/\u0000$/, '');
        var data_start_pos = i + 110 + file_entry.namesize;
        if((data_start_pos % 4) !== 0) data_start_pos += 4 - (data_start_pos % 4);
        file_entry.data = newc_data.slice(data_start_pos, data_start_pos + file_entry.size);
        this.addEntry(file_entry);

        if(file_entry.name === "TRAILER!!!")
            if(file_entry.ino +
                file_entry.mode +
                file_entry.uid +
                file_entry.gid +
                file_entry.nlink +
                file_entry.mtime +
                file_entry.size +
                file_entry.maj +
                file_entry.min +
                file_entry.rmaj +
                file_entry.rmin +
                file_entry.namesize +
                file_entry.chksum +
                file_entry.data.length === 12)
                break;
        i = data_start_pos + file_entry.size;
    }
    if(!this.validate()) throw new Error('Invalid tree, something is wrong.');
}
Tree.prototype.toBuffer = function() {
    function walkTree(node, cb) {
        cb(node.nodeinfo);
        for(var e in node.subdirs)
            walkTree(node.subdirs[e], cb);
        for(var e in node.files)
            cb(node.files[e]);
    }
    if(!this.validate()) {
        console.log('Invalid tree structure.')
        return;
    }
    console.log(console.dir(this._$tree));

    var res_buffer = new Buffer(0);

    walkTree(this._$tree, function(stats) {
        var entry_buffer_len = 110 + stats.namesize;

        if(entry_buffer_len % 4 !== 0) entry_buffer_len += 4 - (entry_buffer_len % 4);
        entry_buffer_len += stats.size;
        if(entry_buffer_len % 4 !== 0) entry_buffer_len += 4 - (entry_buffer_len % 4);

        var entry_buffer = new Buffer(entry_buffer_len);
        // write content

        res_buffer = Buffer.concat([res_buffer, entry_buffer]);
    });

    if(res_buffer.length % 512 !== 0)
        res_buffer = Buffer.concat([res_buffer, new Buffer(512 - res_buffer.length % 512)]);
    
    console.log('Total ' + (res_buffer.length / 512) + ' blocks')

    return res_buffer;
}
Tree.prototype.addEntry = function(entry) {
    if((entry.name === 'TRAILER!!!') && (entry.dev === 0) &&
        (entry.rdev === 0) && (entry.ino === 0) && (entry.mode === 0))
        return;

    if(entry.name === '.') {  // root
        if(this._$tree.nodeinfo !== undefined) throw new Error('Duplicate root node');
        this._$tree.nodeinfo = entry;
        return;
    }
    var path_arr = entry.name.split(/\//g),
        curr_node = this._$tree;
    for(var i = 0; i < path_arr.length - 1; i ++) {
        if(curr_node.subdirs[path_arr[i]] === undefined)
            curr_node.subdirs[path_arr[i]] = { 
                subdirs: { },
                files: { }, 
                nodeinfo: undefined
            }
        curr_node = curr_node.subdirs[path_arr[i]];
    }

    if(entry.isDirectory()) {
        if(curr_node.subdirs[path_arr[path_arr.length - 1]] === undefined)
            curr_node.subdirs[path_arr[path_arr.length - 1]] = {
                subdirs: { },
                files: { }, 
                nodeinfo: entry
            }
        else throw Error('Duplicate directory node ' + entry.name);
    } else {
        if(curr_node.files[path_arr[path_arr.length - 1]] === undefined)
            curr_node.files[path_arr[path_arr.length - 1]] = entry;
        else throw Error('Duplicate entry node ' + entry.name);
    }
};
Tree.prototype.dump = function(max_level) {
    function dump_one_folder(node, level) {
        /* print prefix */ 
        for(var i= 0 ; i < level; i++) {
            if(i === level -1) process.stdout.write('|-');
            else process.stdout.write('| ');
        }
        /* print name */
        process.stdout.write(path.basename(node.nodeinfo.name) + '/');
        if(level >= max_level) {
            console.log(' [...]');
            return;
        } else console.log('');
        /* print subdirs */
        for(var p in node.subdirs)
            dump_one_folder(node.subdirs[p], level + 1);
        /* print files */
        level += 1;
        for(var p in node.files) {
            /* print prefix */
            for(var i= 0 ; i < level; i++) {
                if(i === level -1) process.stdout.write('|-');
                else process.stdout.write('| ');
            }
            /* print name */
            console.log(p);
        }
    }
    dump_one_folder(this._$tree, 0);
};
Tree.prototype.rm = function(p) {
    var path_arr = p.replace(/\/$/, '').split(/\//g),
        curr_node = this._$tree;
    for(var i = 0; i < path_arr.length - 1; i ++) {
        if(curr_node.subdirs[path_arr[i]] === undefined) {
            console.log('Failed to remove non-exit path "' + p + '".');
            return;
        } else curr_node = curr_node.subdirs[path_arr[i]];
    }
    if(curr_node.subdirs[path_arr[path_arr.length - 1]]) {
        delete curr_node.subdirs[path_arr[path_arr.length - 1]];
        console.log('Removed directory "' + p + '".');
    } else if(curr_node.files[path_arr[path_arr.length - 1]]) {
        delete curr_node.files[path_arr[path_arr.length - 1]];
        console.log('Removed entry "' + p + '".');
    } else console.log('Failed to remove non-exit path "' + p + '".');
}
Tree.prototype.ls = function(p) {
    function print_entry(stats, max_nlink_str_len, max_size_str_len) {        
        process.stdout.write(padLeft(stats.mode.toString(8), 6, '0'));
        process.stdout.write(' ');
        process.stdout.write(padLeft(stats.nlink.toString(10), max_nlink_str_len, ' '));
        process.stdout.write(' ');
        process.stdout.write(padLeft(stats.size.toString(10), max_size_str_len, ' '));
        process.stdout.write(' ');
        process.stdout.write(new Date(stats.mtime * 1000).toJSON().replace(/\.000Z$/, ''));
        process.stdout.write(' ');
        process.stdout.write(path.basename(stats.name));
        if(stats.isDirectory()) process.stdout.write('/')
        else if(stats.isSymbolicLink()) {
            process.stdout.write(' -> ');
            process.stdout.write(stats.data);
        }
        process.stdout.write('\n');
    }
    function print_dir(node) {
        var max_size_str_len = 0,
            max_nlink_str_len = 0,
            stats_arr = [ ];
        for(var e in node.subdirs) {
            stats_arr.push(node.subdirs[e].nodeinfo);
            if(node.subdirs[e].nodeinfo.nlink.toString().length > max_nlink_str_len)
                max_nlink_str_len = node.subdirs[e].nodeinfo.nlink.toString().length;
            if(node.subdirs[e].nodeinfo.size.toString().length > max_size_str_len)
                max_size_str_len = node.subdirs[e].nodeinfo.size.toString().length;
        }
        for(var e in node.files) {
            stats_arr.push(node.files[e]);
            if(node.files[e].nlink.toString().length > max_nlink_str_len)
                max_nlink_str_len = node.files[e].nlink.toString().length;
            if(node.files[e].size.toString().length > max_size_str_len)
                max_size_str_len = node.files[e].size.toString().length;
        }
        stats_arr.forEach(function(s) {
            print_entry(s, max_nlink_str_len, max_size_str_len);
        });
    }
    if(p === '.') print_entry(this._$tree.nodeinfo);
    else if(p === './') print_dir(this._$tree);
    else {
        var path_arr = p.replace(/\/$/, '').split(/\//g),
            curr_node = this._$tree;
        for(var i = 0; i < path_arr.length - 1; i ++) {
            if(curr_node.subdirs[path_arr[i]] === undefined) {
                console.log('Path "' + p + '" does not exit.');
                return;
            } else curr_node = curr_node.subdirs[path_arr[i]];
        }
        if(curr_node.subdirs[path_arr[path_arr.length - 1]]) {
            if(/\/$/.test(p)) print_dir(curr_node.subdirs[path_arr[path_arr.length - 1]]);
            else print_entry(curr_node.subdirs[path_arr[path_arr.length - 1]].nodeinfo);
        } else if(curr_node.files[path_arr[path_arr.length - 1]]) print_entry(curr_node.files[path_arr[path_arr.length - 1]]);
        else console.log('Path "' + p + '" does not exit.');        
    }
};
Tree.prototype.cat = function(p) {
    var path_arr = p.replace(/\/$/, '').split(/\//g),
        curr_node = this._$tree;
    for(var i = 0; i < path_arr.length - 1; i ++) {
        if(curr_node.subdirs[path_arr[i]] === undefined) {
            console.log('Path "' + p + '" does not exit.');
            return;
        } else curr_node = curr_node.subdirs[path_arr[i]];
    }
    if(curr_node.subdirs[path_arr[path_arr.length - 1]]) console.log('Path "' + p + '" is a directory.');
    else if(curr_node.files[path_arr[path_arr.length - 1]])
        process.stdout.write(curr_node.files[path_arr[path_arr.length - 1]].data);
    else console.log('Path "' + p + '" does not exit.');
}

function main_dump_tree_initramfs() {
    var imgfile = undefined,
        max_level = undefined;

    for(var i = 2; i < process.argv.length; i ++) {
        if(imgfile === undefined) imgfile = process.argv[i];
        else if(max_level === undefined) max_level = parseInt(process.argv[i]);
        else {
            console.log('Invalid commandline option: ' + process.argv[i]);
            return help();
        }
    }
    if((!imgfile) || (typeof imgfile !== 'string') || 
        (imgfile.trim().length === 0) || (!fs.existsSync(imgfile)) ||
        (!fs.statSync(imgfile).isFile())) {
        console.log('Invalid image file: ' + imgfile);
        return 1;
    }
    if(max_level === undefined) max_level = Number.MAX_VALUE;
    if(Number.isNaN(max_level)) {
        console.log('Invalid max dump level ' + max_level);
        return 1;
    }

    zlib.gunzip(fs.readFileSync(imgfile), function(err, newc_data) {
        new Tree(newc_data).dump(max_level);
    })
}

function main_list_initramfs() {
    var imgfile = undefined,
        target_path = undefined;

    for(var i = 2; i < process.argv.length; i ++) {
        if(imgfile === undefined) imgfile = process.argv[i];
        else if(target_path === undefined) target_path = process.argv[i];
        else {
            console.log('Invalid commandline option: ' + process.argv[i]);
            return help();
        }
    }
    if((!imgfile) || (typeof imgfile !== 'string') || 
        (imgfile.trim().length === 0) || (!fs.existsSync(imgfile)) ||
        (!fs.statSync(imgfile).isFile())) {
        console.log('Invalid image file: ' + imgfile);
        return 1;
    }
    if(!target_path) target_path = './';

    zlib.gunzip(fs.readFileSync(imgfile), function(err, newc_data) {
        new Tree(newc_data).ls(target_path);
    })
}

function main_cat_file_initramfs() {
    var imgfile = undefined,
        target_path = undefined;

    for(var i = 2; i < process.argv.length; i ++) {
        if(imgfile === undefined) imgfile = process.argv[i];
        else if(target_path === undefined) target_path = process.argv[i];
        else {
            console.log('Invalid commandline option: ' + process.argv[i]);
            return help();
        }
    }
    if((!imgfile) || (typeof imgfile !== 'string') || 
        (imgfile.trim().length === 0) || (!fs.existsSync(imgfile)) ||
        (!fs.statSync(imgfile).isFile())) {
        console.log('Invalid image file: ' + imgfile);
        return 1;
    }
    if((!target_path)|| (typeof target_path !== 'string') || (target_path.trim().length === 0)) {
        console.log('Invalid target file: ' + target_path);
        return 1;
    }

    zlib.gunzip(fs.readFileSync(imgfile), function(err, newc_data) {
        new Tree(newc_data).cat(target_path);
    })
}

function main_create_initramfs() {
    var root_dir = undefined,
        output_file = undefined;

    for(var i = 2; i < process.argv.length; i ++) {
        if(root_dir === undefined) root_dir = process.argv[i];
        else if(output_file === undefined) output_file = process.argv[i];
        else {
            console.log('Invalid commandline option: ' + process.argv[i]);
            return help();
        }
    }
    if((!root_dir) || (typeof root_dir !== 'string') || 
        (root_dir.trim().length === 0) || (!fs.existsSync(root_dir)) ||
        (!fs.statSync(root_dir).isDirectory())) {
        console.log('Invalid root dir: ' + root_dir);
        return 1;
    }
    if((!output_file)|| (typeof output_file !== 'string') || 
        (output_file.trim().length === 0) || (!fs.existsSync(path.dirname(output_file))) || 
        (!fs.statSync(path.dirname(output_file)).isDirectory())) {
        console.log('Invalid output path: ' + output_file);
        return 1;
    }    

    var tree = new Tree,
        root_stats = fs.statSync(root_dir);
    root_stats.mtime = Math.floor(root_stats.mtime.getTime() / 1000);
    root_stats.maj = root_stats.dev >> 8;
    root_stats.min = root_stats.dev - (root_stats.maj << 8);
    root_stats.rmaj = root_stats.rdev >> 8;
    root_stats.rmin = root_stats.rdev - (root_stats.rmaj << 8);
    root_stats.namesize = 2;
    root_stats.chksum = 0;
    root_stats.name = '.';
    root_stats.data = new Buffer(0);

    tree.addEntry(root_stats);

    function walkLocalTree(target_path, archive_path) {
        var non_dirs = [ ];
        fs.readdirSync(target_path).forEach(function(e) {
            var entry_path = archive_path.slice(),
                local_path = path.join(target_path, e),
                stats = fs.lstatSync(local_path);

            entry_path.push(e);
            stats.name = entry_path.join('/');
            if(stats.isSymbolicLink()) stats.data = new Buffer(fs.readlinkSync(local_path));
            else if(stats.isFile()) stats.data = fs.readFileSync(local_path);
            else stats.data = new Buffer(0);
            stats.chksum = 0;
            stats.namesize = stats.name.length + 1;
            stats.maj = stats.dev >> 8;
            stats.min = stats.dev - (stats.maj << 8);
            stats.rmaj = stats.rdev >> 8;
            stats.rmin = stats.rdev - (stats.rmaj << 8);
            stats.mtime = Math.floor(stats.mtime.getTime() / 1000);
            
            if(stats.isDirectory()) {
                tree.addEntry(stats);
                walkLocalTree(local_path, entry_path);
            } else non_dirs.push(stats);
        });
        non_dirs.forEach(function(e) {
            tree.addEntry(e);
        });
    }
    walkLocalTree(root_dir, [ ]);

    zlib.gzip(tree.toBuffer(), function(err, gz_data) {
        fs.writeFileSync(output_file, gz_data);
    });
}

if(require.main === module) {
    switch(process.argv[2]) {
        case "t":
        case "tree":
            process.argv.splice(2, 1);
            main_dump_tree_initramfs();
            break;
        case "l":
        case "ls":
        case "list":
            process.argv.splice(2, 1);
            main_list_initramfs();
            break;
        case "cat":
            process.argv.splice(2, 1);
            main_cat_file_initramfs();
            break;
        case "c":
        case "create":
            process.argv.splice(2, 1);
            main_create_initramfs();
            break;
        case "m":
        case "modify":
            process.argv.splice(2, 1);
            main_modify_initramfs();
            break;
        default: return help();
    }
} else module.exports = Tree;


// See: https://www.kernel.org/doc/Documentation/early-userspace/buffer-format.txt
//
//
//                initramfs buffer format
//                -----------------------
//
//                Al Viro, H. Peter Anvin
//               Last revision: 2002-01-13
//
// Starting with kernel 2.5.x, the old "initial ramdisk" protocol is
// getting {replaced/complemented} with the new "initial ramfs"
// (initramfs) protocol.  The initramfs contents is passed using the same
// memory buffer protocol used by the initrd protocol, but the contents
// is different.  The initramfs buffer contains an archive which is
// expanded into a ramfs filesystem; this document details the format of
// the initramfs buffer format.
//
// The initramfs buffer format is based around the "newc" or "crc" CPIO
// formats, and can be created with the cpio(1) utility.  The cpio
// archive can be compressed using gzip(1).  One valid version of an
// initramfs buffer is thus a single .cpio.gz file.
//
// The full format of the initramfs buffer is defined by the following
// grammar, where:
//     *    is used to indicate "0 or more occurrences of"
//     (|)    indicates alternatives
//     +    indicates concatenation
//     GZIP()    indicates the gzip(1) of the operand
//     ALGN(n)    means padding with null bytes to an n-byte boundary
//
//     initramfs  := ("\0" | cpio_archive | cpio_gzip_archive)*
//
//     cpio_gzip_archive := GZIP(cpio_archive)
//
//     cpio_archive := cpio_file* + (<nothing> | cpio_trailer)
//
//     cpio_file := ALGN(4) + cpio_header + filename + "\0" + ALGN(4) + data
//
//     cpio_trailer := ALGN(4) + cpio_header + "TRAILER!!!\0" + ALGN(4)
//
//
// In human terms, the initramfs buffer contains a collection of
// compressed and/or uncompressed cpio archives (in the "newc" or "crc"
// formats); arbitrary amounts zero bytes (for padding) can be added
// between members.
//
// The cpio "TRAILER!!!" entry (cpio end-of-archive) is optional, but is
// not ignored; see "handling of hard links" below.
//
// The structure of the cpio_header is as follows (all fields contain
// hexadecimal ASCII numbers fully padded with '0' on the left to the
// full width of the field, for example, the integer 4780 is represented
// by the ASCII string "000012ac"):
//
// Field name    Field size     Meaning
// c_magic          6 bytes         The string "070701" or "070702"
// c_ino          8 bytes         File inode number
// c_mode          8 bytes         File mode and permissions
// c_uid          8 bytes         File uid
// c_gid          8 bytes         File gid
// c_nlink          8 bytes         Number of links
// c_mtime          8 bytes         Modification time
// c_filesize    8 bytes         Size of data field
// c_maj          8 bytes         Major part of file device number
// c_min          8 bytes         Minor part of file device number
// c_rmaj          8 bytes         Major part of device node reference
// c_rmin          8 bytes         Minor part of device node reference
// c_namesize    8 bytes         Length of filename, including final \0
// c_chksum      8 bytes         Checksum of data field if c_magic is 070702;
//                  otherwise zero
//
// The c_mode field matches the contents of st_mode returned by stat(2)
// on Linux, and encodes the file type and file permissions.
//
// The c_filesize should be zero for any file which is not a regular file
// or symlink.
//
// The c_chksum field contains a simple 32-bit unsigned sum of all the
// bytes in the data field.  cpio(1) refers to this as "crc", which is
// clearly incorrect (a cyclic redundancy check is a different and
// significantly stronger integrity check), however, this is the
// algorithm used.
//
// If the filename is "TRAILER!!!" this is actually an end-of-archive
// marker; the c_filesize for an end-of-archive marker must be zero.
//
//
// *** Handling of hard links
//
// When a nondirectory with c_nlink > 1 is seen, the (c_maj,c_min,c_ino)
// tuple is looked up in a tuple buffer.  If not found, it is entered in
// the tuple buffer and the entry is created as usual; if found, a hard
// link rather than a second copy of the file is created.  It is not
// necessary (but permitted) to include a second copy of the file
// contents; if the file contents is not included, the c_filesize field
// should be set to zero to indicate no data section follows.  If data is
// present, the previous instance of the file is overwritten; this allows
// the data-carrying instance of a file to occur anywhere in the sequence
// (GNU cpio is reported to attach the data to the last instance of a
// file only.)
//
// c_filesize must not be zero for a symlink.
//
// When a "TRAILER!!!" end-of-archive marker is seen, the tuple buffer is
// reset.  This permits archives which are generated independently to be
// concatenated.
//
// To combine file data from different sources (without having to
// regenerate the (c_maj,c_min,c_ino) fields), therefore, either one of
// the following techniques can be used:
//
// a) Separate the different file data sources with a "TRAILER!!!"
//    end-of-archive marker, or
//
// b) Make sure c_nlink == 1 for all nondirectory entries.