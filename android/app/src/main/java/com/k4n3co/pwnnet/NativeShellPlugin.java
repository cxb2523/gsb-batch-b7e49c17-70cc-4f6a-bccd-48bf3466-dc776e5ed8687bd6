package com.k4n3co.pwnnet;

import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "NativeShell")
public class NativeShellPlugin extends Plugin {

    @PluginMethod
    public void execute(PluginCall call) {
        String command = call.getString("command");
        if (command == null || command.isEmpty()) {
            call.reject("Command is required");
            return;
        }
        call.setKeepAlive(true);
        new Thread(() -> {
            try {
                getBridge().executeOnMainThread(() -> {
                    JSObject ack = new JSObject();
                    ack.put("line", "BRIDGE_CONNECTED: Native shell initialized.");
                    notifyListeners("stdout", ack);
                });
                List<String> commandArgs = new ArrayList<>(Arrays.asList(command.trim().split("\\s+")));
                String binaryName = commandArgs.get(0);
                String nativeLibDir = getContext().getApplicationInfo().nativeLibraryDir;
                File chosenFile = new File(nativeLibDir, "lib" + binaryName + ".so");
                if (!chosenFile.exists()) {
                    File fallbackFile = new File(getContext().getFilesDir().getParentFile(), "lib/lib" + binaryName + ".so");
                    if (fallbackFile.exists()) {
                        chosenFile = fallbackFile;
                    } else {
                        call.reject("Native binary not found: " + binaryName);
                        return;
                    }
                }
                boolean isScript = false;
                try (InputStream fis = new java.io.FileInputStream(chosenFile)) {
                    byte[] header = new byte[2];
                    if (fis.read(header) == 2 && header[0] == '#' && header[1] == '!') isScript = true;
                } catch (IOException ignored) {}
                List<String> finalArgs = new ArrayList<>();
                if (isScript) finalArgs.add("/system/bin/sh");
                finalArgs.add(chosenFile.getAbsolutePath());
                if (commandArgs.size() > 1) finalArgs.addAll(commandArgs.subList(1, commandArgs.size()));
                ProcessBuilder pb = new ProcessBuilder(finalArgs);
                pb.directory(getContext().getFilesDir());
                pb.redirectErrorStream(true);
                Process process = pb.start();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        final String outputLine = line;
                        getBridge().executeOnMainThread(() -> {
                            JSObject data = new JSObject();
                            data.put("line", outputLine);
                            notifyListeners("stdout", data);
                        });
                    }
                }
                int exitCode = process.waitFor();
                Thread.sleep(200);
                final JSObject result = new JSObject();
                result.put("exitCode", exitCode);
                getBridge().executeOnMainThread(() -> { notifyListeners("completed", result); });
                call.resolve(result);
            } catch (Exception e) { call.reject(e.getMessage()); }
        }).start();
    }

    @PluginMethod
    public void prepareWordlist(PluginCall call) {
        String name = call.getString("name");
        String content = call.getString("content");
        if (name == null || content == null) { call.reject("Missing data"); return; }
        try {
            File file = new File(getContext().getFilesDir(), name);
            java.io.FileWriter writer = new java.io.FileWriter(file);
            writer.write(content);
            writer.close();
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    /**
     * PWNNET NATIVE CRACKER v6.0 - GRANULAR MUTATION ENGINE
     */
    @PluginMethod
    public void crackHash(PluginCall call) {
        String targetHash = call.getString("hash");
        String type = call.getString("type");
        String wordlistName = call.getString("wordlist");
        
        // Granular Mutation Config
        boolean useCaps = Boolean.TRUE.equals(call.getBoolean("useCaps", false));
        boolean useNumbers = Boolean.TRUE.equals(call.getBoolean("useNumbers", false));
        boolean usePunct = Boolean.TRUE.equals(call.getBoolean("usePunct", false));
        boolean useLeet = Boolean.TRUE.equals(call.getBoolean("useLeet", false));

        if (targetHash == null || type == null || wordlistName == null) {
            call.reject("Missing parameters");
            return;
        }

        call.setKeepAlive(true);

        new Thread(() -> {
            try {
                String typeKey = type.toLowerCase().replace("raw-", "");
                int iterations = 1;
                
                if (typeKey.contains("wallet") || typeKey.contains("metamask") || typeKey.contains("bitcoin") || typeKey.contains("wpa")) {
                    iterations = 10000;
                }

                String algo = "SHA-256";
                if (typeKey.equals("md5")) algo = "MD5";
                else if (typeKey.equals("sha1")) algo = "SHA-1";
                else if (typeKey.equals("sha512")) algo = "SHA-512";
                
                java.security.MessageDigest md = java.security.MessageDigest.getInstance(algo);
                
                boolean found = false;
                String plaintext = "";
                long totalVariantsTested = 0;
                long startTime = System.currentTimeMillis();

                String assetPath = "wordlists/" + wordlistName;
                InputStream is;
                try {
                    is = getContext().getAssets().open(assetPath);
                } catch (IOException e) {
                    call.reject("Wordlist not found: " + wordlistName);
                    return;
                }

                try (BufferedReader reader = new BufferedReader(new InputStreamReader(is))) {
                    String baseWord;
                    while ((baseWord = reader.readLine()) != null) {
                        String word = baseWord.trim();
                        if (word.isEmpty()) continue;

                        Set<String> variants = new HashSet<>();
                        variants.add(word);
                        
                        // Apply Mutations based on user config
                        if (useCaps) {
                            variants.add(word.toUpperCase());
                            variants.add(word.substring(0, 1).toUpperCase() + (word.length() > 1 ? word.substring(1).toLowerCase() : ""));
                        }
                        
                        if (useNumbers) {
                            String[] numSuffixes = {"1", "123", "2025", "2026", "01"};
                            for (String s : numSuffixes) variants.add(word + s);
                        }

                        if (usePunct) {
                            String[] punctSuffixes = {"!", "!!", "@", "#", "$", "?"};
                            for (String s : punctSuffixes) variants.add(word + s);
                        }

                        if (useLeet) {
                            String leet = word.replace("a", "@").replace("A", "@")
                                              .replace("s", "$").replace("S", "$")
                                              .replace("e", "3").replace("E", "3")
                                              .replace("o", "0").replace("O", "0")
                                              .replace("i", "1").replace("I", "1")
                                              .replace("t", "7").replace("T", "7");
                            if (!leet.equals(word)) {
                                variants.add(leet);
                                if (useNumbers) variants.add(leet + "123");
                                if (usePunct) variants.add(leet + "!");
                            }
                        }

                        for (String variant : variants) {
                            totalVariantsTested++;
                            byte[] currentHash = variant.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                            
                            for (int iter = 0; iter < iterations; iter++) {
                                md.reset();
                                currentHash = md.digest(currentHash);
                            }

                            StringBuilder sb = new StringBuilder();
                            for (byte b : currentHash) sb.append(String.format("%02x", b));
                            
                            if (sb.toString().equalsIgnoreCase(targetHash)) {
                                found = true;
                                plaintext = variant;
                                break;
                            }
                            
                            if (totalVariantsTested % (iterations > 1 ? 50 : 2000) == 0) {
                                final long count = totalVariantsTested;
                                final String testing = variant;
                                getBridge().executeOnMainThread(() -> {
                                    JSObject data = new JSObject();
                                    data.put("line", "Active Compute: " + count + " variations... testing: " + testing);
                                    notifyListeners("stdout", data);
                                });
                            }
                        }
                        if (found) break;
                    }
                }

                final boolean finalFound = found;
                final String finalPlain = plaintext;
                final long duration = (System.currentTimeMillis() - startTime) / 1000;
                
                getBridge().executeOnMainThread(() -> {
                    JSObject data = new JSObject();
                    JSObject res = new JSObject();
                    if (finalFound) {
                        data.put("line", "\n[+] MATCH FOUND in " + duration + "s!");
                        data.put("line", "[+] Plaintext: " + finalPlain);
                        notifyListeners("stdout", data);
                        res.put("success", true);
                        res.put("plaintext", finalPlain);
                    } else {
                        data.put("line", "\n[!] Engine: Exhausted wordlist. No matches found.");
                        notifyListeners("stdout", data);
                        res.put("success", false);
                    }
                    notifyListeners("completed", res);
                    call.resolve(res);
                });

            } catch (Exception e) { call.reject(e.getMessage()); }
        }).start();
    }

    /**
     * One LAN scan session. Holds the plugin call, worker pool, cancellation
     * flag and every host discovered so far. All mutating paths are
     * synchronized so that scan completion and user cancellation can never
     * resolve the same call twice.
     *
     * Rule parity: the validation / prefix / dedup / ordering / status rules
     * mirror src/shared/lanScan.ts 1:1 — change both together.
     */
    private static final class LanScanSessionData {
        final PluginCall call;
        final ExecutorService pool;
        final Set<String> hosts = new HashSet<>();
        volatile boolean cancelled = false;
        boolean finalized = false;

        LanScanSessionData(PluginCall call, ExecutorService pool) {
            this.call = call;
            this.pool = pool;
        }
    }

    private volatile LanScanSessionData activeScan;
    private static final Pattern DIGITS = Pattern.compile("\\d+");

    /**
     * Shared subnet validation — Java mirror of validateSubnet() in
     * src/shared/lanScan.ts. Rejects before any thread pool is created:
     *   1. non-empty string containing '/';
     *   2. at least three numeric dotted octets before '/'.
     * Returns null when valid, otherwise a human-readable rejection reason.
     */
    private String validateSubnet(String subnet) {
        if (subnet == null || subnet.isEmpty()) {
            return "Target subnet required";
        }
        if (!subnet.contains("/")) {
            return "Subnet must contain \"/\" (e.g. 192.168.1.0/24)";
        }
        String addressPart = subnet.split("/")[0];
        String[] octets = addressPart.split("\\.");
        if (octets.length < 3) {
            return "Subnet prefix must contain at least three dotted octets (e.g. 192.168.1.0/24)";
        }
        for (int i = 0; i < 3; i++) {
            if (!DIGITS.matcher(octets[i].trim()).matches()) {
                return "Subnet octet #" + (i + 1) + " (\"" + octets[i] + "\") is not a number";
            }
        }
        return null;
    }

    /** Java mirror of derivePrefix() in src/shared/lanScan.ts. */
    private String derivePrefix(String subnet) {
        String addressPart = subnet.split("/")[0];
        return addressPart.substring(0, addressPart.lastIndexOf('.') + 1);
    }

    private static int lastOctet(String ip) {
        try {
            return Integer.parseInt(ip.substring(ip.lastIndexOf('.') + 1));
        } catch (NumberFormatException e) {
            return Integer.MAX_VALUE;
        }
    }

    @PluginMethod
    public void scanLAN(PluginCall call) {
        String subnet = call.getString("subnet");

        // Validate BEFORE starting anything: invalid input rejects immediately
        // and no thread pool / network work is ever scheduled.
        String rejection = validateSubnet(subnet);
        if (rejection != null) {
            call.reject(rejection);
            return;
        }
        final String prefix = derivePrefix(subnet);

        final LanScanSessionData session = new LanScanSessionData(
                call, Executors.newFixedThreadPool(64));
        activeScan = session;
        call.setKeepAlive(true);

        new Thread(() -> {
            try {
                for (int i = 1; i < 255; i++) {
                    if (session.cancelled) break;
                    final String host = prefix + i;
                    session.pool.execute(() -> {
                        // A task already queued when cancel() arrives must no-op.
                        if (session.cancelled) return;
                        try {
                            if (InetAddress.getByName(host).isReachable(500)) {
                                boolean accept;
                                synchronized (session) {
                                    accept = !session.cancelled && !session.finalized
                                            && session.hosts.add(host);
                                }
                                if (accept) {
                                    JSObject result = new JSObject();
                                    result.put("ip", host);
                                    result.put("status", "alive");
                                    getBridge().executeOnMainThread(
                                            () -> notifyListeners("hostFound", result));
                                }
                            }
                        } catch (Exception ignored) {}
                    });
                }
                session.pool.shutdown();
                session.pool.awaitTermination(30, TimeUnit.SECONDS);
                finishScan(session, session.cancelled ? "cancelled" : "completed");
            } catch (Exception e) {
                finishScan(session, session.cancelled ? "cancelled" : "completed");
            }
        }).start();
    }

    /**
     * Cancel the running scan. Already-discovered hosts are preserved; the
     * scan resolves (exactly once) with status "cancelled" and no further
     * hostFound events are emitted.
     */
    @PluginMethod
    public void cancelScan(PluginCall call) {
        LanScanSessionData session = activeScan;
        if (session != null) {
            session.cancelled = true;
            session.pool.shutdownNow();
            finishScan(session, "cancelled");
        }
        JSObject ack = new JSObject();
        ack.put("cancelled", true);
        call.resolve(ack);
    }

    /**
     * Single finalization path: whichever of (natural completion, timeout,
     * cancellation, error) wins the synchronized race resolves the plugin
     * call; every later invocation returns the same result object and never
     * resolves or rejects a second time.
     */
    private void finishScan(LanScanSessionData session, String status) {
        JSObject done;
        synchronized (session) {
            if (session.finalized) {
                return;
            }
            session.finalized = true;
            if ("cancelled".equals(status)) {
                session.cancelled = true;
            }
            List<String> sorted = new ArrayList<>(session.hosts);
            sorted.sort(Comparator.comparingInt(NativeShellPlugin::lastOctet));
            JSArray hostArray = new JSArray();
            for (String ip : sorted) {
                hostArray.put(ip);
            }
            done = new JSObject();
            done.put("status", status);
            done.put("hosts", hostArray);
            done.put("found", sorted.size());
            if (activeScan == session) {
                activeScan = null;
            }
        }
        session.call.resolve(done);
    }
}
