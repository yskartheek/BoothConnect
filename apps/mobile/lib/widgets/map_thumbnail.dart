import 'package:flutter/material.dart';

import '../l10n/generated/app_localizations.dart';
import '../theme/tokens.g.dart';

/// A drawn preview that a location is saved. It never loads map tiles: the
/// household's position isn't sent anywhere, and it works offline.
class MapThumbnail extends StatelessWidget {
  const MapThumbnail({super.key, this.accuracyM});

  final double? accuracyM;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      container: true,
      image: true,
      label: accuracyM == null
          ? l10n.householdLocationSaved
          : l10n.householdLocationAccuracy(accuracyM!.round()),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(BcRadius.medium),
        child: SizedBox(
          height: 96,
          width: double.infinity,
          child: CustomPaint(
            painter: _MapPainter(
              ground: colors.surfaceContainerHighest,
              road: colors.surface,
            ),
            child: Center(
              child: Icon(Icons.location_on, size: 32, color: colors.primary),
            ),
          ),
        ),
      ),
    );
  }
}

class _MapPainter extends CustomPainter {
  const _MapPainter({required this.ground, required this.road});

  final Color ground;
  final Color road;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = ground);
    final paint = Paint()
      ..color = road
      ..strokeWidth = 10
      ..style = PaintingStyle.stroke;
    canvas
      ..drawLine(
        Offset(0, size.height * 0.62),
        Offset(size.width, size.height * 0.38),
        paint,
      )
      ..drawLine(
        Offset(size.width * 0.3, 0),
        Offset(size.width * 0.38, size.height),
        paint..strokeWidth = 6,
      );
  }

  @override
  bool shouldRepaint(_MapPainter old) =>
      old.ground != ground || old.road != road;
}
