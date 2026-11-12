import * as React from 'react';
import { Alert, Image, Text, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  SignatureInk,
  type ExportFormat,
  type SignatureInkHandle,
} from 'react-native-signature-ink';

import type { RootStackParamList } from '../App';
import {
  Action,
  Screen,
  Section,
  Toggle,
  useScreenStyles,
} from '../ui/ScreenShell';

type Props = NativeStackScreenProps<RootStackParamList, 'Exports'>;

export default function ExportsScreen({ navigation }: Props) {
  const styles = useScreenStyles();
  const ref = React.useRef<SignatureInkHandle>(null);

  const [format, setFormat] = React.useState<ExportFormat>('png');
  const [trim, setTrim] = React.useState(true);
  const [preview, setPreview] = React.useState<string | null>(null);

  const wrap = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      const text = r == null ? '(ok)' : String(r);
      Alert.alert(label, text.length > 200 ? text.slice(0, 200) + '…' : text);
    } catch (e) {
      Alert.alert(`${label} failed`, String(e));
    }
  };

  const onBase64 = () =>
    wrap('toBase64', async () => {
      const b64 = await ref.current?.toBase64({ format, trim });
      if (b64) {
        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        setPreview(`data:${mime};base64,${b64}`);
      }
      return b64 ? `${b64.length} chars` : null;
    });

  const onFile = () =>
    wrap('toFile', async () =>
      ref.current?.toFile({ format, quality: 0.9, trim })
    );

  const onSvg = async () => {
    try {
      const svg = await ref.current?.toSvg();
      if (svg) {
        Clipboard.setString(svg);
        Alert.alert(
          'SVG copied',
          `${svg.length} chars copied to the clipboard. Paste into a text editor to inspect.`
        );
      } else {
        Alert.alert('toSvg', '(empty)');
      }
    } catch (e) {
      Alert.alert('toSvg failed', String(e));
    }
  };

  const onCopy = () => {
    ref.current?.copyToClipboard();
    Alert.alert('Clipboard', 'Signature copied. Paste in any app to verify.');
  };

  const onPhoto = () =>
    wrap('saveToPhotoLibrary', async () => {
      const r = await ref.current?.saveToPhotoLibrary({ format, trim });
      if (r?.granted === false) {
        return 'permission denied — enable in OS settings';
      }
      return r?.uri ?? 'saved to Photos';
    });

  // Fires two exports back to back: a valid one that must resolve, and one
  // with an unsupported format that must reject in JS with a readable
  // error — without crashing the screen or disturbing the valid request.
  const onVerifyFormats = async () => {
    const handle = ref.current;
    if (!handle) {
      Alert.alert('Canvas not mounted yet');
      return;
    }
    const describe = (r: PromiseSettledResult<unknown>) =>
      r.status === 'fulfilled'
        ? `resolved (${typeof r.value === 'string' ? `${r.value.length} chars` : String(r.value)})`
        : `rejected: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`;
    const [valid, invalid] = await Promise.allSettled([
      handle.toBase64({ format: 'png', trim }),
      // Intentionally unsupported — must reject before any native dispatch.
      handle.toFile({ format: 'gif' as unknown as ExportFormat, trim }),
    ]);
    Alert.alert(
      'Async result verification',
      `valid format → ${describe(valid)}\n\ninvalid format → ${describe(invalid)}`
    );
  };

  // Starts an export and immediately pops the screen. The pending request
  // must reject with an "unmounted" error (see the Metro console) and no
  // unhandled-promise warning may appear.
  const onVerifyUnmount = () => {
    const handle = ref.current;
    if (!handle) return;
    handle
      .toBase64({ format: 'png' })
      .then((r) =>
        console.log(
          `[SignatureInk verify] resolved before unmount (${r.length} chars) — rerun and leave faster`
        )
      )
      .catch((e: unknown) =>
        console.log(
          '[SignatureInk verify] rejected after unmount:',
          e instanceof Error ? e.message : String(e)
        )
      );
    navigation.goBack();
  };

  return (
    <Screen>
      <Text style={styles.title}>Export the signature</Text>
      <Text style={styles.description}>
        Every export honors the same `format` / `quality` / `trim` options. The
        Photos export will prompt the user for permission the first time on iOS
        (`NSPhotoLibraryAddUsageDescription` is required) and writes to
        `Pictures/Signatures` via MediaStore on Android.
      </Text>

      <View style={styles.canvasWrapper}>
        <SignatureInk
          ref={ref}
          style={styles.canvas}
          penColor="#111"
          showBaseline
        />
      </View>

      <Section label="Options">
        <View style={styles.row}>
          <Toggle
            label="format = jpeg"
            value={format === 'jpeg'}
            onChange={(v) => setFormat(v ? 'jpeg' : 'png')}
          />
          <Toggle label="trim to strokes" value={trim} onChange={setTrim} />
        </View>
      </Section>

      <Section label="Imperative API">
        <View style={styles.row}>
          <Action label="toBase64" onPress={onBase64} />
          <Action label="toFile" onPress={onFile} />
          <Action label="toSvg" onPress={onSvg} />
          <Action label="copyToClipboard" onPress={onCopy} />
          <Action label="saveToPhotoLibrary" onPress={onPhoto} />
          <Action
            label="Clear"
            variant="danger"
            onPress={() => {
              ref.current?.clear();
              setPreview(null);
            }}
          />
        </View>
      </Section>

      <Section label="Async result contract">
        <Text style={styles.description}>
          Fires two exports back to back — one valid, one with an unsupported
          format. The first must resolve normally, the second must reject with a
          readable error, and the screen must not crash.
        </Text>
        <View style={styles.row}>
          <Action
            label="Verify valid + invalid format"
            onPress={onVerifyFormats}
          />
        </View>
        <Text style={styles.description}>
          "Export, then leave page" starts an export and immediately pops this
          screen. Watch the Metro console: the pending request must reject with
          an "unmounted" error and no unhandled-promise warning may appear.
        </Text>
        <View style={styles.row}>
          <Action label="Export, then leave page" onPress={onVerifyUnmount} />
        </View>
      </Section>

      {preview != null && (
        <View style={styles.previewWrap}>
          <Text style={styles.description}>Preview (base64 round-trip)</Text>
          <Image source={{ uri: preview }} style={styles.preview} />
        </View>
      )}
    </Screen>
  );
}
