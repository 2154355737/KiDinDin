pub fn metadata_fields(
    biz_id: Option<String>,
    add_watermark: bool,
    address: Option<String>,
) -> Vec<(&'static str, String)> {
    let mut fields = vec![
        ("bizId", biz_id.unwrap_or_default()),
        ("isIphone", "false".into()),
        ("addWatermark", add_watermark.to_string()),
    ];
    if add_watermark {
        fields.extend([
            ("watermarkStyle.rotate", "0".into()),
            ("watermarkStyle.color", "EE2C2C".into()),
            ("address", address.unwrap_or_default()),
        ]);
    }
    fields
}

#[cfg(test)]
mod tests {
    use super::metadata_fields;

    #[test]
    fn disabled_watermark_never_sends_address_or_style() {
        let fields = metadata_fields(Some("attachments".into()), false, Some("stale address".into()));
        assert!(fields.iter().any(|(name, value)| *name == "addWatermark" && value == "false"));
        assert!(fields.iter().any(|(name, value)| *name == "bizId" && value == "attachments"));
        assert!(!fields.iter().any(|(name, _)| name.starts_with("watermarkStyle") || *name == "address"));
    }

    #[test]
    fn enabled_watermark_keeps_contract() {
        let fields = metadata_fields(None, true, Some("building".into()));
        for expected in [("addWatermark", "true"), ("watermarkStyle.rotate", "0"),
            ("watermarkStyle.color", "EE2C2C"), ("address", "building")] {
            assert!(fields.iter().any(|(name, value)| *name == expected.0 && value == expected.1));
        }
    }
}
