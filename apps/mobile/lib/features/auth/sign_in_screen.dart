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
///
/// One app for volunteers and voters (#226): a voter chooses **Voter** and
/// gives their voter ID (EPIC) and the mobile number on their record.
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
  final _epic = TextEditingController();
  var _step = _Step.phone;

  /// Signing in as a voter (#226).
  var _voter = false;
  String? _epicError;
  var _busy = false;
  String? _sentTo;
  String? _fieldError;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    _epic.dispose();
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

  /// The voter ID as the API takes it: no spaces, upper case.
  static String? _normaliseEpic(String input) {
    final s = input.replaceAll(RegExp(r'\s'), '').toUpperCase();
    return RegExp(r'^[A-Z0-9]{5,20}$').hasMatch(s) ? s : null;
  }

  Future<void> _sendCode() async {
    final phone = normalizePhone(_phone.text);
    final epic = _voter ? _normaliseEpic(_epic.text) : null;
    setState(() {
      _fieldError = phone == null ? context.l10n.signInPhoneInvalid : null;
      _epicError = _voter && epic == null
          ? context.l10n.voterEpicInvalid
          : null;
    });
    if (phone == null || (_voter && epic == null)) return;
    await _run(() async {
      final api = ref.read(authApiProvider);
      if (_voter) {
        await api.requestVoterOtp(epic!, phone);
      } else {
        await api.requestOtp(phone);
      }
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
      final auth = ref.read(authProvider.notifier);
      final result = _voter
          ? await auth.signInVoter(_normaliseEpic(_epic.text)!, _sentTo!, code)
          : await auth.signIn(_sentTo!, code);
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
        // Volunteers and voters use the same app (#226).
        Semantics(
          label: l10n.signInAsLabel,
          child: SegmentedButton<bool>(
            segments: [
              ButtonSegment(value: false, label: Text(l10n.signInAsVolunteer)),
              ButtonSegment(value: true, label: Text(l10n.signInAsVoter)),
            ],
            selected: {_voter},
            showSelectedIcon: false,
            onSelectionChanged: _busy
                ? null
                : (s) => setState(() {
                    _voter = s.single;
                    _error = null;
                    _fieldError = null;
                    _epicError = null;
                  }),
          ),
        ),
        const SizedBox(height: BcSpacing.md),
        if (_voter) ...[
          Text(l10n.voterSignInIntro),
          const SizedBox(height: BcSpacing.sm),
          TextField(
            controller: _epic,
            enabled: !_busy,
            textCapitalization: TextCapitalization.characters,
            textInputAction: TextInputAction.next,
            decoration: InputDecoration(
              labelText: l10n.voterEpicLabel,
              helperText: l10n.voterEpicHelp,
              helperMaxLines: 3,
              errorText: _epicError,
              errorMaxLines: 3,
            ),
          ),
          const SizedBox(height: BcSpacing.sm),
        ],
        TextField(
          controller: _phone,
          enabled: !_busy,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _sendCode(),
          decoration: InputDecoration(
            labelText: l10n.signInPhoneLabel,
            helperText: _voter ? l10n.voterPhoneHelp : l10n.signInPhoneHelp,
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
        if (_voter) ..._voterNotes(),
        ..._errorAndHint(),
      ],
    );
  }

  /// Who sees what, and that this isn't the Election Commission's app.
  List<Widget> _voterNotes() {
    final muted = TextStyle(color: AppTokens.of(context).textMuted);
    return [
      const SizedBox(height: BcSpacing.md),
      Text(context.l10n.voterPrivacyLine, style: muted),
      const SizedBox(height: BcSpacing.xs),
      Text(context.l10n.voterNotOfficial, style: muted),
    ];
  }

  Widget _codeStep() {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _heading(),
        const SizedBox(height: BcSpacing.sm),
        // A voter isn't told whether the details matched (#223).
        Text(
          _voter ? l10n.voterCodeSent(_sentTo!) : l10n.signInCodeSent(_sentTo!),
        ),
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
