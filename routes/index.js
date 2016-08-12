var fs = require('fs')
var exec = require('child_process').exec
var iconv = require('iconv-lite')
var archiver = require('archiver')
var express = require('express');
var router = express.Router();

/* GET home page. */


router.get('/items',function(req, res, next){
	var ret = JSON.parse(fs.readFileSync('data/items.json'))
	res.send(ret.data)
})

router.post('/items/add',function(req, res, next){
	var ret = JSON.parse(fs.readFileSync('data/items.json'))
	var id = ++ret.uid
	var name = req.body.name
	var svn_url = req.body.svn_url
	ret.data.push({	
		id: id,
		name: name,
		svn_url: svn_url
	})
	fs.writeFileSync('data/items.json',JSON.stringify(ret))
	fs.writeFileSync('data/'+ id +'.json',JSON.stringify({
		id: id,
		name: name,
		svn_url: svn_url,
		tag: "",
		rev: "",
		is_online: false,
		is_init: false,
		$info: {}
	}))
	fs.mkdirSync("files/"+id)
	res.send({status:'ok'})
})

router.get('/items/:id',function(req, res, next){
	var id = req.params.id
	var data = JSON.parse(fs.readFileSync('data/'+ id +'.json'))
	var cmd = "svn log " + data.svn_url
	var info = data.$info
	exec(cmd,{encoding:'binary'},function(err,stdout,stderr){	
		if(err) throw err
		stdout = iconv.decode(stdout, 'GBK')
		var out = stdout.replace(/line\r\n\r\n/g,'line|').replace(/\r\n/g,'').replace(/\s+/g,'').split(/-{2,}/g)
		var ret = []
		for(var i=0;i<out.length;i++){	
			var it = out[i].split('|')
			if(/r\d+/.test(it[0])){	
				var item
				var rev = it[0].substr(1)
				var author = it[1]
				var date = it[2].substr(0,10)
				var msg = it[4] || '' 
				if(info[rev]){	
					item = info[rev]
				}else{	
					item = {}
				}
				item.rev = rev
				item.author = author
				item.date = date
				item.msg = msg
				ret.push(item)
			}
		}
		data.list = ret
		res.send(data)

	})
})

router.post('/items/:id/init/:rev',function(req, res, next){	
	var id = req.params.id
	var jsonfile = 'data/'+ id +'.json'
	var data = JSON.parse(fs.readFileSync(jsonfile))
	var rev = req.params.rev
	data.$info[rev] = {	
		"tag": "1.0",
		"rev": rev,
		"patch_url": "",
		"is_online": true
	}
	data.tag = "1.0"
	data.rev = rev
	data.is_init = true
	data.is_online = true
	fs.writeFileSync(jsonfile,JSON.stringify(data))
	res.send({status:"ok"})
})

router.post('/items/:id/online/:rev', function(req, res, next){	
	var id = req.params.id
	var jsonfile = 'data/'+ id +'.json'
	var data = JSON.parse(fs.readFileSync(jsonfile))
	var rev = req.params.rev
	var item = data.$info[rev]
	item.is_online = true
	data.tag = item.tag
	data.rev = item.rev
	data.is_online = true
	fs.writeFileSync(jsonfile,JSON.stringify(data))
	res.send({status:"ok"})
})

router.post('/items/:id/unline/:rev', function(req, res, next){	
	var id = req.params.id
	var jsonfile = 'data/'+ id +'.json'
	var data = JSON.parse(fs.readFileSync(jsonfile))
	var rev = req.params.rev
	data.is_online = true
	delete data.$info[rev]
	fs.writeFileSync(jsonfile,JSON.stringify(data))
	res.send({status:"ok"})
})

router.post('/items/:id/pkg/:rev',function(req,res,next){
	var id = req.params.id
	var jsonfile = 'data/'+ id +'.json'
	var data = JSON.parse(fs.readFileSync(jsonfile))
	var version = (parseFloat(data.tag) + 0.1).toFixed(1)
	var rev = req.params.rev
	var svn = data.svn_url
	var temp = "files/temp_"+id
	var zip = "files/" + id + "/" + "app_"+ version +".zip"

	exec("svn export --force -r " + rev + " " + svn + " " + temp,function(err,stdout,stderr){	

		if(err) throw err

		console.log('文件导出成功')

		var output = fs.createWriteStream(zip)
		var archive = archiver('zip')
		output.on('close', function() {
			console.log("打包完成")
		})
		archive.on('error', function(err) {
		  throw err
		})
		archive.pipe(output)

		function copy(src){
			var file = temp + "/" + src
			var isDir = file.indexOf(".") < 0 
			if(isDir){	
				archive.append(null,{name:src+"/"})
			}else{
				archive.append(fs.createReadStream(file),{name:src})
			}
		}
		exec("svn diff --summarize -r " + data.rev + ":" + rev + " " + svn,function(err,stdout,stderr){
			if(err) throw err
			var diff = stdout.split('\r\n')
			console.log(diff)
			var json = {	
				"version": version,
				"modifiedCount": 0,
				"modifiedArr": [],
				"addedCount": 0,
				"addedArr": [],
				"deletedCount": 0,
				"deletedArr": []
			}
			for(var i=0;i<diff.length;i++){
				var str = diff[i]
				if(str){
					var op = str.substr(0,1)
					var file = str.substr(9+svn.length)
					switch(op){	
						case "M" : 
							json.modifiedArr.push(file)
							copy(file)
						break
						case "A" : 
							json.addedArr.push(file)
							copy(file)
						break
						case "D" :
							json.deletedArr.push(file)
						break
					}
				}
			}
			json.modifiedCount = json.modifiedArr.length
			json.addedCount = json.addedArr.length
			json.deletedCount = json.deletedArr.length
			archive.append(JSON.stringify(json),{name:"package.json"}).finalize()

			data.is_online = false
			data.$info[rev] = {	
				"tag": version,
				"rev": rev,
				"is_online": false,
				"patch_url": zip.substr(5)
			}

			fs.writeFileSync(jsonfile,JSON.stringify(data))

			res.send(json)
		})

	})
})


module.exports = router;
