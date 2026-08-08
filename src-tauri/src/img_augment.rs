use image::{DynamicImage, ImageFormat, RgbImage};
use rand::Rng;

const MAX_PROCESSING_EDGE: u32 = 2_048;

/// 对图片进行随机增广：裁剪、左右翻转、调色、加噪，统一重编码为 JPEG。
/// 每次调用产生不同结果，用于规避后端重复图片检测。
pub fn augment_image(bytes: &[u8], format: ImageFormat) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory_with_format(bytes, format)
        .map_err(|_| "图片内容损坏，无法解码".to_string())?;

    augment_prepared_image(&prepare_image_for_augmentation(image))
}

pub fn prepare_image_for_augmentation(image: DynamicImage) -> DynamicImage {
    if image.width() > MAX_PROCESSING_EDGE || image.height() > MAX_PROCESSING_EDGE {
        image.thumbnail(MAX_PROCESSING_EDGE, MAX_PROCESSING_EDGE)
    } else {
        image
    }
}

pub fn augment_prepared_image(image: &DynamicImage) -> Result<Vec<u8>, String> {
    render_augmented_image(image).map(|(bytes, _)| bytes)
}

pub fn augment_prepared_image_with_preview(
    image: &DynamicImage,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let (bytes, rgb) = render_augmented_image(image)?;
    let thumbnail = DynamicImage::ImageRgb8(rgb).thumbnail(360, 360).to_rgb8();
    let mut preview = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut preview, 76)
        .encode_image(&thumbnail)
        .map_err(|_| "生成增广预览失败".to_string())?;
    Ok((bytes, preview))
}

fn render_augmented_image(image: &DynamicImage) -> Result<(Vec<u8>, RgbImage), String> {
    let mut image = image.clone();

    let mut rng = rand::thread_rng();

    // 1. 随机裁剪：保留 92%-100% 面积，随机偏移
    image = random_crop(image, &mut rng);

    // 2. 固定左右镜像，不再进行上下翻转
    image = image.fliph();

    // 3. 色相轻微偏移
    let hue: i32 = rng.gen_range(-8..=8); // 色相微小偏移
    image = image.huerotate(hue);

    // 4. 在一次像素遍历中完成亮度、对比度和噪声调整
    let brightness: i16 = rng.gen_range(-20..=20);
    let contrast_percent: i16 = rng.gen_range(90..=110);
    let rgb = adjust_color_and_add_noise(image, brightness, contrast_percent, &mut rng);

    // 5. JPEG 重编码，质量 70-90 随机（默认清除 EXIF）
    let quality: u8 = rng.gen_range(70..=90);
    let mut output = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, quality);
    encoder
        .encode_image(&rgb)
        .map_err(|_| "图片重新编码失败".to_string())?;

    Ok((output, rgb))
}

fn random_crop(mut image: DynamicImage, rng: &mut impl Rng) -> DynamicImage {
    let (w, h) = (image.width(), image.height());
    if w < 10 || h < 10 {
        return image;
    }

    // 保留 92%-100% 的尺寸
    let min_ratio = 0.92f64;
    let scale_w: f64 = rng.gen_range(min_ratio..=1.0);
    let scale_h: f64 = rng.gen_range(min_ratio..=1.0);

    let new_w = (w as f64 * scale_w).max(1.0) as u32;
    let new_h = (h as f64 * scale_h).max(1.0) as u32;

    let max_x = w.saturating_sub(new_w);
    let max_y = h.saturating_sub(new_h);

    let x = if max_x > 0 {
        rng.gen_range(0..=max_x)
    } else {
        0
    };
    let y = if max_y > 0 {
        rng.gen_range(0..=max_y)
    } else {
        0
    };

    image.crop(x, y, new_w, new_h)
}

fn adjust_color_and_add_noise(
    image: DynamicImage,
    brightness: i16,
    contrast_percent: i16,
    rng: &mut impl Rng,
) -> RgbImage {
    let mut rgb: RgbImage = image.to_rgb8();
    let mut noise_state = rng.gen::<u64>().max(1);
    const DELTAS: [i16; 16] = [-4, -3, -2, -1, 0, 1, 2, 3, 4, 0, 1, -1, 2, -2, 3, -3];
    for pixel in rgb.pixels_mut() {
        noise_state ^= noise_state << 13;
        noise_state ^= noise_state >> 7;
        noise_state ^= noise_state << 17;
        pixel[0] = adjust_channel(
            pixel[0],
            brightness,
            contrast_percent,
            DELTAS[(noise_state & 0x0f) as usize],
        );
        pixel[1] = adjust_channel(
            pixel[1],
            brightness,
            contrast_percent,
            DELTAS[((noise_state >> 4) & 0x0f) as usize],
        );
        pixel[2] = adjust_channel(
            pixel[2],
            brightness,
            contrast_percent,
            DELTAS[((noise_state >> 8) & 0x0f) as usize],
        );
    }
    rgb
}

fn adjust_channel(value: u8, brightness: i16, contrast_percent: i16, noise: i16) -> u8 {
    let contrasted = ((value as i16 - 128) * contrast_percent) / 100 + 128;
    (contrasted + brightness + noise).clamp(0, 255) as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageFormat;

    #[test]
    fn same_input_produces_different_output() {
        // 创建一个 100x100 的纯色测试图片
        let mut img = image::RgbImage::new(100, 100);
        for pixel in img.pixels_mut() {
            pixel[0] = 128;
            pixel[1] = 100;
            pixel[2] = 80;
        }
        let mut buf = Vec::new();
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90);
        enc.encode_image(&img).unwrap();

        let result1 = augment_image(&buf, ImageFormat::Jpeg).unwrap();
        let result2 = augment_image(&buf, ImageFormat::Jpeg).unwrap();

        // 两次增广应该产生不同的输出
        assert_ne!(result1, result2, "两次增广应产生不同的字节");

        // 输出应该是有效的 JPEG
        assert!(image::guess_format(&result1).is_ok());
        assert!(image::guess_format(&result2).is_ok());
    }

    #[test]
    fn output_is_valid_jpeg() {
        let mut img = image::RgbImage::new(50, 50);
        for pixel in img.pixels_mut() {
            pixel[0] = 200;
            pixel[1] = 150;
            pixel[2] = 100;
        }
        let mut buf = Vec::new();
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 85);
        enc.encode_image(&img).unwrap();

        let result = augment_image(&buf, ImageFormat::Jpeg).unwrap();
        let format = image::guess_format(&result).unwrap();
        assert_eq!(format, ImageFormat::Jpeg);

        // 确认尺寸在合理范围（裁剪后 ≥92% 面积，边长 ≥ √0.92 ≈ 0.959）
        let decoded = image::load_from_memory(&result).unwrap();
        assert!(decoded.width() >= 46, "裁剪后宽度不应小于原始宽度的92%");
        assert!(decoded.height() >= 46, "裁剪后高度不应小于原始高度的92%");
    }

    #[test]
    fn large_photo_is_bounded_before_augmentation() {
        let prepared = prepare_image_for_augmentation(DynamicImage::new_rgb8(4032, 3024));
        assert_eq!(prepared.width(), 2048);
        assert_eq!(prepared.height(), 1536);

        let (output, preview) = augment_prepared_image_with_preview(&prepared).unwrap();
        let decoded = image::load_from_memory(&output).unwrap();
        assert!(decoded.width() <= MAX_PROCESSING_EDGE);
        assert!(decoded.height() <= MAX_PROCESSING_EDGE);
        assert_eq!(image::guess_format(&preview).unwrap(), ImageFormat::Jpeg);
    }

    #[test]
    fn augmentation_always_flips_left_and_right() {
        let mut source = RgbImage::new(200, 100);
        for (x, _y, pixel) in source.enumerate_pixels_mut() {
            *pixel = if x < 100 {
                image::Rgb([230, 30, 30])
            } else {
                image::Rgb([30, 30, 230])
            };
        }

        let output = augment_prepared_image(&DynamicImage::ImageRgb8(source)).unwrap();
        let decoded = image::load_from_memory(&output).unwrap().to_rgb8();
        let left = decoded.get_pixel(2, decoded.height() / 2);
        let right = decoded.get_pixel(decoded.width() - 3, decoded.height() / 2);
        assert!(left[2] > left[0], "左右翻转后左侧应来自原图蓝色右半区");
        assert!(right[0] > right[2], "左右翻转后右侧应来自原图红色左半区");
    }
}
