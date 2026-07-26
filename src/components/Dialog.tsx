import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { create } from 'zustand';
import { colors, radius, spacing } from '@/theme';

// React Native's Alert has no web implementation — react-native-web ships
// `static alert() {}`, an empty function. Since Stockpile runs as a PWA on the
// phone, every confirmation built on Alert.alert silently did nothing. This is
// a drop-in replacement with the same call shape that renders a real dialog on
// every platform.

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface DialogState {
  visible: boolean;
  title: string;
  message?: string;
  buttons: DialogButton[];
  show: (title: string, message?: string, buttons?: DialogButton[]) => void;
  hide: () => void;
}

const useDialogStore = create<DialogState>((set) => ({
  visible: false,
  title: '',
  message: undefined,
  buttons: [],
  show: (title, message, buttons) =>
    set({ visible: true, title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] }),
  hide: () => set({ visible: false }),
}));

/** Same signature as Alert.alert, but it actually shows up. */
export function showDialog(title: string, message?: string, buttons?: DialogButton[]) {
  useDialogStore.getState().show(title, message, buttons);
}

/** Mounted once at the app root. */
export function DialogHost() {
  const { visible, title, message, buttons, hide } = useDialogStore();

  // iOS orders a stacked alert with the cancel action last.
  const ordered = [
    ...buttons.filter((b) => b.style !== 'cancel'),
    ...buttons.filter((b) => b.style === 'cancel'),
  ];
  const cancel = buttons.find((b) => b.style === 'cancel');

  const press = (b: DialogButton) => {
    hide();
    // Let the dialog close before the action runs — an action that opens
    // another dialog would otherwise be swallowed by this one closing.
    setTimeout(() => b.onPress?.(), 0);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => (cancel ? press(cancel) : hide())}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            {message ? <Text style={styles.message}>{message}</Text> : null}
          </View>
          <View>
            {ordered.map((b, i) => (
              <TouchableOpacity
                key={`${b.text}-${i}`}
                style={styles.btn}
                activeOpacity={0.6}
                onPress={() => press(b)}>
                <Text
                  style={[
                    styles.btnTxt,
                    b.style === 'destructive' && { color: colors.red },
                    b.style === 'cancel' && { color: colors.muted, fontWeight: '600' },
                  ]}>
                  {b.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: '#000000BB',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  head: { padding: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  message: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  btn: {
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  btnTxt: { color: colors.blue, fontSize: 16, fontWeight: '700' },
});
