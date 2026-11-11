package app.hongguo.runtime;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.parser.Feature;
import com.alibaba.fastjson.parser.ParserConfig;
import com.github.unidbg.AndroidEmulator;
import com.github.unidbg.Module;
import com.github.unidbg.file.FileResult;
import com.github.unidbg.linux.android.AndroidEmulatorBuilder;
import com.github.unidbg.linux.android.AndroidResolver;
import com.github.unidbg.linux.android.dvm.*;
import com.github.unidbg.linux.android.dvm.array.ArrayObject;
import com.github.unidbg.linux.android.dvm.array.ByteArray;
import com.github.unidbg.linux.android.dvm.wrapper.DvmBoolean;
import com.github.unidbg.linux.file.SimpleFileIO;
import com.github.unidbg.pointer.UnidbgPointer;
import com.github.unidbg.virtualmodule.android.AndroidModule;
import com.github.unidbg.virtualmodule.android.JniGraphics;

import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** A private, sequential process boundary. No network server or diagnostic commands. */
public final class SignerBridge implements AutoCloseable {
    private static final String APP = "com.dragon.read.oversea.gp";
    private static final String APP_DATA = "/data/user/0/" + APP;
    private static final String MS = "com/bytedance/mobsec/metasec/ml/MS";
    private final AndroidEmulator machine;
    private final Module library;

    private SignerBridge(Path sdk) throws Exception {
        Path binary = sdk.resolve("libmetasec_ml.so");
        byte[] certificate = Files.readAllBytes(sdk.resolve("ms_16777218.bin"));
        // No backend factory: unidbg's default UnicornBackend is the tested Windows backend.
        machine = AndroidEmulatorBuilder.for64Bit().setProcessName(APP).build();
        machine.set("uid", 10074);
        machine.set("inode", Map.of(APP_DATA, 655781, APP_DATA + "/files", 655864));
        machine.getSyscallHandler().setVerbose(false);
        machine.getSyscallHandler().addIOResolver((emulator, path, flags) ->
            path.endsWith("/libmetasec_ml.so")
                ? FileResult.success(new SimpleFileIO(flags, binary.toFile(), path)) : null);
        machine.getMemory().setLibraryResolver(new AndroidResolver(23));
        VM vm = machine.createDalvikVM();
        vm.setVerbose(false);
        vm.setJni(new AndroidCallbacks(certificate));
        new AndroidModule(machine, vm).register(machine.getMemory());
        new JniGraphics(machine, vm).register(machine.getMemory());
        vm.loadLibrary(sdk.resolve("libc++_shared.so").toFile(), false);
        DvmClass base = vm.resolveClass("ms/bd/c/m");
        vm.resolveClass(MS, vm.resolveClass("ms/bd/c/a4$a", base));
        DalvikModule loaded = vm.loadLibrary(binary.toFile(), true);
        library = loaded.getModule();
        loaded.callJNI_OnLoad(machine);
    }

    private Map<String, String> sign(JSONObject request) {
        String url = request.getString("url");
        URI address = URI.create(url);
        if (!"https".equalsIgnoreCase(address.getScheme()) || address.getHost() == null)
            throw new IllegalArgumentException();
        Object rawHeaders = request.get("headers");
        if (!(rawHeaders instanceof JSONObject)) throw new IllegalArgumentException();
        StringJoiner headerText = new StringJoiner("\r\n");
        for (Map.Entry<String, Object> entry : ((JSONObject) rawHeaders).entrySet()) {
            String name = entry.getKey();
            if (!name.matches("[!#$%&'*+.^_`|~0-9A-Za-z-]+") || !(entry.getValue() instanceof String))
                throw new IllegalArgumentException();
            String value = (String) entry.getValue();
            if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) throw new IllegalArgumentException();
            headerText.add(name).add(value);
        }
        Number pointerValue = library.callFunction(machine, 0x168c80L, url, headerText.toString());
        if (pointerValue == null || pointerValue.longValue() == 0) throw new IllegalStateException();
        UnidbgPointer pointer = machine.getMemory().pointer(pointerValue.longValue());
        if (pointer == null) throw new IllegalStateException();
        String[] fields = pointer.getString(0).split("\r?\n");
        if (fields.length == 0 || fields.length % 2 != 0) throw new IllegalStateException();
        Map<String, String> result = new LinkedHashMap<>();
        for (int i = 0; i < fields.length; i += 2) {
            String name = fields[i].trim();
            String value = fields[i + 1].trim();
            if (!name.matches("(?i)x-[a-z0-9-]+") || value.isEmpty()) throw new IllegalStateException();
            result.put(name, value);
        }
        if (result.keySet().stream().noneMatch(k -> k.equalsIgnoreCase("x-gorgon")))
            throw new IllegalStateException();
        return result;
    }

    @Override public void close() throws IOException { machine.close(); }

    public static void main(String[] args) throws IOException {
        PrintStream responses = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        PrintStream silent = new PrintStream(OutputStream.nullOutputStream());
        System.setOut(silent);
        System.setErr(silent);
        System.setProperty("org.slf4j.simpleLogger.defaultLogLevel", "off");
        ParserConfig.getGlobalInstance().setSafeMode(true);
        SignerBridge engine = null;
        try (BufferedReader requests = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = requests.readLine()) != null) {
                Map<String, Object> response = new LinkedHashMap<>();
                response.put("seq", null);
                try {
                    if (line.length() > 131072) throw new IllegalArgumentException();
                    JSONObject request = JSON.parseObject(line, Feature.DisableSpecialKeyDetect, Feature.OrderedField);
                    Object seq = request.get("seq");
                    if (!(seq instanceof String) && !(seq instanceof Number)) throw new IllegalArgumentException();
                    response.put("seq", seq);
                    if (args.length != 1) throw new IllegalArgumentException();
                    if (engine == null) engine = new SignerBridge(Path.of(args[0]).toAbsolutePath());
                    response.put("headers", engine.sign(request));
                } catch (Throwable failure) {
                    // Never echo exception text: native errors can include URLs and request headers.
                    response.put("error", "SIGN_FAILED");
                }
                responses.println(JSON.toJSONString(response, com.alibaba.fastjson.serializer.SerializerFeature.WriteMapNullValue));
                if (responses.checkError()) break;
            }
        } finally {
            if (engine != null) try { engine.close(); } catch (Throwable ignored) { }
        }
    }

    /** Minimal host values required by the observed Android JNI contract. */
    private static final class AndroidCallbacks extends AbstractJni {
        private final byte[] certificate;
        AndroidCallbacks(byte[] certificate) { this.certificate = certificate; }

        private DvmObject<?> query(BaseVM vm, int operation) {
            return switch (operation) {
                case 65539 -> new StringObject(vm, APP_DATA + "/files/.msdata");
                case 16777218 -> new ByteArray(vm, certificate);
                case 16777232 -> vm.resolveClass("java/lang/Integer").newObject(68132);
                case 16777233 -> new StringObject(vm, "6.8.1.32");
                case 33554433, 33554434 -> DvmBoolean.valueOf(vm, true);
                case 268435470 -> vm.resolveClass("java/lang/Long").newObject(System.currentTimeMillis());
                default -> null;
            };
        }

        @Override public DvmObject<?> callStaticObjectMethodV(BaseVM vm, DvmClass type, String method, VaList arguments) {
            if (method.startsWith(MS + "->b(")) return query(vm, arguments.getIntArg(0));
            if (method.equals("java/lang/Thread->currentThread()Ljava/lang/Thread;"))
                return vm.resolveClass("java/lang/Thread").newObject(Thread.currentThread());
            return super.callStaticObjectMethodV(vm, type, method, arguments);
        }

        @Override public DvmObject<?> callObjectMethodV(BaseVM vm, DvmObject<?> receiver, String method, VaList arguments) {
            Object host = receiver.getValue();
            if (method.equals("java/lang/Thread->getStackTrace()[Ljava/lang/StackTraceElement;")) {
                DvmClass element = vm.resolveClass("java/lang/StackTraceElement");
                return new ArrayObject(Arrays.stream(((Thread) host).getStackTrace())
                    .map(element::newObject).toArray(DvmObject<?>[]::new));
            }
            if (host instanceof StackTraceElement frame) {
                if (method.equals("java/lang/StackTraceElement->getClassName()Ljava/lang/String;"))
                    return new StringObject(vm, frame.getClassName());
                if (method.equals("java/lang/StackTraceElement->getMethodName()Ljava/lang/String;"))
                    return new StringObject(vm, frame.getMethodName());
            }
            if (method.equals("java/lang/Thread->getBytes(Ljava/lang/String;)[B"))
                return new ByteArray(vm, ((String) arguments.getObjectArg(0).getValue()).getBytes(StandardCharsets.UTF_8));
            return super.callObjectMethodV(vm, receiver, method, arguments);
        }

        @Override public int callIntMethodV(BaseVM vm, DvmObject<?> receiver, String method, VaList arguments) {
            return method.equals("java/lang/Integer->intValue()I") ? (Integer) receiver.getValue()
                : super.callIntMethodV(vm, receiver, method, arguments);
        }
        @Override public long callLongMethodV(BaseVM vm, DvmObject<?> receiver, String method, VaList arguments) {
            return method.equals("java/lang/Long->longValue()J") ? (Long) receiver.getValue()
                : super.callLongMethodV(vm, receiver, method, arguments);
        }
        @Override public boolean callBooleanMethodV(BaseVM vm, DvmObject<?> receiver, String method, VaList arguments) {
            return method.equals("java/lang/Boolean->booleanValue()Z") ? (Boolean) receiver.getValue()
                : super.callBooleanMethodV(vm, receiver, method, arguments);
        }
        @Override public int getStaticIntField(BaseVM vm, DvmClass type, String field) {
            return field.equals(MS + "->a()V") ? 0x40 : super.getStaticIntField(vm, type, field);
        }
        @Override public void callVoidMethod(BaseVM vm, DvmObject<?> receiver, String method, VarArg arguments) {
            if (!method.equals(MS + "->a()V")) super.callVoidMethod(vm, receiver, method, arguments);
        }
    }
}
