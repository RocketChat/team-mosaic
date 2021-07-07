const Crawler = require("crawler");
const got = require('got');
const sharp = require('sharp');
const cliProgress = require('cli-progress');
const express = require('express')
const { join } = require('path')

const canvasWidth = 1440;
const canvasHeight = 810;
const spacing = 4;
const background = 'transparent';
const width = 200;
const height = 200;

const resize = {
	width,
	height,
	fit: sharp.fit.cover,
	position: 'top',
};

async function getListOfImages() {
	console.log('Getting list of files...');
	return new Promise((resolve) => {
		const c = new Crawler({
			callback: function(error, res, done) {
				if (error) {
					return console.log({error})
				}

				const images = res.$('.img-profile')
				resolve(images.get().filter((i) => i.attribs && i.attribs.style).map((i) => i.attribs.style.replace('background-image: url(', '').replace(/\)$/, '')));
			}
		})

		c.queue('https://rocket.chat/team')
	});
}

async function downloadImgAndResize(images) {
	// images = images.slice(0, 51);
	console.log('Downloading images...');
	const bar = new cliProgress.SingleBar({});
	bar.start(images.length, 0);

	const buffers = [];
	for await (const image of images) {
		try {
			const response = await got(image);
			buffers.push(await sharp(response.rawBody, {failOnError: false})
				.on('error', (e) => console.log(image, e))
				.resize(resize).toBuffer());
		} catch(e) {
			continue;
		} finally {
			bar.increment();
		}
	}
	bar.stop();
	return buffers;
}

async function generateMosaic(sources) {
	console.log('Generating mosaic...');

	sources.sort( () => .5 - Math.random() );

	const imageProportion = width / height;
	console.log(imageProportion);
	const proportion = canvasWidth / canvasHeight;
	const columns = Math.round(Math.pow(sources.length / imageProportion, 1/proportion));
	const rows = Math.ceil(sources.length / columns);
	const missing = columns - sources.length % columns;

	if (missing > 0) {
		const missingImg = await sharp(join(__dirname, '_files', 'missing.jpg'))
			.on('error', (e) => console.log(image, e))
			.resize({
				...resize,
				position: 'center',
			}).toBuffer();

		sources.push(...new Array(missing).fill(missingImg));
	}

	return sharp({
		create: {
			width: columns * (width + spacing) + spacing,
			height: rows * (height + spacing) + spacing,
			channels: 4,
			background,
		}
	})
	.composite(sources.map((s, i) => {
		return {
			input: s,
			left: (i % columns) * (width + spacing) + spacing,
			top: Math.trunc(i/columns) * (height + spacing) + spacing,
		}
	}))
	.png()
	.pipe(sharp()
		.resize(canvasWidth, canvasHeight, {
			background,
			fit: 'contain',
		})
	)
	.toBuffer()
	// .toFile(outputImg);
}

const app = express()

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.get('/api/mosaic', async (req, res) => {
	const img = await getListOfImages()
		.then(downloadImgAndResize)
		.then(generateMosaic);

	res.contentType('png');
	res.setHeader('Cache-Control', 's-max-age=1, stale-while-revalidate');
	res.send(img);
})

module.exports = app;