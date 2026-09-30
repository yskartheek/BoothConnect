import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/api/api_error.dart';
import '../../data/api/providers.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../l10n/shared_labels.g.dart';
import '../../theme/app_theme.dart';
import '../../theme/glass_surface.dart';
import '../../theme/tokens.g.dart';
import '../../widgets/states.dart';
import 'auth_controller.dart';
import 'phone.dart';

enum _Step { phone, code, denied }

/// Sign-in with a code sent by SMS: phone number, then the code. Someone
/// without a volunteer assignment sees the denied state.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key, this.showDevHint = kDebugMode});

  /// Development builds say where the code is (the API's log).
  final bool showDevHint;

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  var _step = _Step.phone;
  var _busy = false;
  String? _sentTo;
  String? _fieldError;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  String _messageFor(ApiError e, AppLocalizations l10n) => e.isNetwork
      ? l10n.signInNetworkError
      : errorMessage(l10n, e.code) ?? l10n.errorInternalError;

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = _messageFor(e, context.l10n));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendCode() async {
    final phone = normalizePhone(_phone.text);
    if (phone == null) {
      setState(() => _fieldError = context.l10n.signInPhoneInvalid);
      return;
    }
    setState(() => _fieldError = null);
    await _run(() async {
      await ref.read(authApiProvider).requestOtp(phone);
      if (!mounted) return;
      setState(() {
        _sentTo = phone;
        _code.clear();
        _step = _Step.code;
      });
    });
  }

  Future<void> _signIn() async {
    final code = _code.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _fieldError = context.l10n.signInCodeInvalid);
      return;
    }
    setState(() => _fieldError = null);
    await _run(() async {
      final result = await ref
          .read(authProvider.notifier)
          .signIn(_sentTo!, code);
      // Signed in: the router moves on by itself.
      if (result == SignInResult.noAssignment && mounted) {
        setState(() => _step = _Step.denied);
      }
    });
  }

  void _backToPhone() => setState(() {
    _step = _Step.phone;
    _error = null;
    _fieldError = null;
  });

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.appTitle)),
      body: SafeArea(
        child: _step == _Step.denied
            ? DeniedState(
                message: l10n.signInDeniedMessage,
                action: OutlinedButton(
                  onPressed: _backToPhone,
                  child: Text(l10n.signInUseAnotherNumber),
                ),
              )
            : SingleChildScrollView(
                padding: const EdgeInsets.all(BcSpacing.lg),
                child: GlassSurface(
                  child: _step == _Step.phone ? _phoneStep() : _codeStep(),
                ),
              ),
      ),
    );
  }

  Widget _heading() => Semantics(
    header: true,
    child: Text(
      context.l10n.signInTitle,
      style: Theme.of(context).textTheme.headlineSmall,
    ),
  );

  Widget _phoneStep() {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _heading(),
        const SizedBox(height: BcSpacing.md),
        TextField(
          controller: _phone,
          enabled: !_busy,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _sendCode(),
          decoration: InputDecoration(
            labelText: l10n.signInPhoneLabel,
            helperText: l10n.signInPhoneHelp,
            helperMaxLines: 3,
            errorText: _fieldError,
            errorMaxLines: 3,
          ),
        ),
        const SizedBox(height: BcSpacing.lg),
        _BusyButton(
          label: l10n.signInSendCode,
          busy: _busy,
          onPressed: _sendCode,
        ),
        ..._errorAndHint(),
      ],
    );
  }

  Widget _codeStep() {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _heading(),
        const SizedBox(height: BcSpacing.sm),
        Text(l10n.signInCodeSent(_sentTo!)),
        const SizedBox(height: BcSpacing.md),
        TextField(
          controller: _code,
          enabled: !_busy,
          autofocus: true,
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          maxLength: 6,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _signIn(),
          decoration: InputDecoration(
            labelText: l10n.signInCodeLabel,
            errorText: _fieldError,
            errorMaxLines: 3,
          ),
        ),
        const SizedBox(height: BcSpacing.md),
        _BusyButton(label: l10n.signInSubmit, busy: _busy, onPressed: _signIn),
        const SizedBox(height: BcSpacing.xs),
        TextButton(
          onPressed: _busy ? null : _backToPhone,
          child: Text(l10n.signInChangeNumber),
        ),
        ..._errorAndHint(),
      ],
    );
  }

  List<Widget> _errorAndHint() {
    final tokens = AppTokens.of(context);
    return [
      if (_error != null) ...[
        const SizedBox(height: BcSpacing.md),
        Semantics(
          liveRegion: true,
          child: Text(_error!, style: TextStyle(color: tokens.danger)),
        ),
      ],
      if (widget.showDevHint) ...[
        const SizedBox(height: BcSpacing.md),
        Text(
          context.l10n.signInDevHint,
          style: TextStyle(color: tokens.textMuted),
        ),
      ],
    ];
  }
}

/// A button that shows a spinner, and can't be pressed, while busy.
class _BusyButton extends StatelessWidget {
  const _BusyButton({
    required this.label,
    required this.busy,
    required this.onPressed,
  });

  final String label;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => FilledButton(
    onPressed: busy ? null : onPressed,
    child: busy
        ? Semantics(
            label: label,
            child: const SizedBox.square(
              dimension: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          )
        : Text(label),
  );
}

extension on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);
}
