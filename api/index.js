const Crawler = require("crawler");
const got = require('got');
const sharp = require('sharp');
const cliProgress = require('cli-progress');
const express = require('express')
const { join } = require('path')

const defaultConfig = {
	canvasWidth: 1440,
	canvasHeight: 810,
	spacing: 4,
	background: 'transparent',
	width: 200,
	height: 200,
	position: 'top',
	maxImages: 0,
	extraImages: -1,
	random: 1,
	simulate: 0
}

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

async function downloadImgAndResize({width, height, position, maxImages, simulate}, images) {
	if (maxImages) {
		images = images.slice(0, maxImages);
	}

	if (simulate) {
		const missingImg = await sharp(join(__dirname, '_files', 'missing.jpg'))
			.on('error', (e) => console.log(image, e))
			.resize({
				width,
				height,
				fit: sharp.fit.cover,
				position: 'center',
			}).toBuffer();
		return images.map(() => missingImg);
	}

	console.log('Downloading images...');
	const bar = new cliProgress.SingleBar({});
	bar.start(images.length, 0);

	const buffers = [];
	for await (const image of images) {
		try {
			const response = await got(image);
			buffers.push(await sharp(response.rawBody, {failOnError: false})
				.on('error', (e) => console.log(image, e))
				.resize({
					width,
					height,
					fit: sharp.fit.cover,
					position,
				}).toBuffer());
		} catch(e) {
			continue;
		} finally {
			bar.increment();
		}
	}
	bar.stop();
	return buffers;
}

async function generateMosaic({width, height, background, spacing, canvasHeight, canvasWidth, extraImages, random}, sources) {
	console.log('Generating mosaic...');

	if (random) {
		sources.sort( () => .5 - Math.random() );
	}

	const length = sources.length + (extraImages > -1 ? extraImages : 0);

	const canvasArea = canvasHeight * canvasWidth;
	const originalImageArea = width * height;
	const imageArea = Math.trunc(canvasArea / length);
	const imageProportion = Math.sqrt(originalImageArea / imageArea);
	const imageWidth = width / imageProportion;
	const columns = Math.trunc(canvasWidth / imageWidth);
	const rows = Math.ceil(length / columns);
	const missing = extraImages > -1 ? extraImages : columns - length % columns;

	// console.log(canvasWidth / imageWidth, canvasWidth, imageWidth, imageWidth * canvasWidth / imageWidth, length)
	if (missing > 0) {
		const missingImg = await sharp(join(__dirname, '_files', 'missing.jpg'))
			.on('error', (e) => console.log(image, e))
			.resize({
				width,
				height,
				fit: sharp.fit.cover,
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
	const config = {
		...defaultConfig,
		...req.query
	};

	for (const [key, value] of Object.entries(defaultConfig)) {
		if (typeof value === 'number') {
			config[key] = parseFloat(config[key], 10);
			if (isNaN(config[key])) {
				res.status(400);
				return res.send({error: `Invalid value for property '${key}'`});
			}
		}
	}

	const list = await getListOfImages();
	const imgs = await downloadImgAndResize(config, list);
	const mosaic = await generateMosaic(config, imgs)

	res.contentType('png');
	res.setHeader('Cache-Control', 's-max-age=1, stale-while-revalidate');
	res.send(mosaic);
})

module.exports = app;