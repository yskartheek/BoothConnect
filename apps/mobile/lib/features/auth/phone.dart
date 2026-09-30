/// The number in international format (`+919876543210`), or null when it
/// can't be one.
///
/// Accepts what people type: spaces, dashes and brackets; a 10-digit Indian
/// mobile number (starting 6–9), with or without a leading 0 or 91; or any
/// number that starts with + and a country code.
String? normalizePhone(String input) {
  final s = input.replaceAll(RegExp(r'[\s\-().]'), '');
  if (RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(s)) return s;
  final indian = RegExp(r'^(?:0|91)?([6-9]\d{9})$').firstMatch(s);
  if (indian != null) return '+91${indian.group(1)}';
  return null;
}
