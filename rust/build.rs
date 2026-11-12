use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::Path;

use wreq_util::{Platform, Profile};

fn main() {
    // Get all variants directly from the enum using VARIANTS API
    let profiles: Vec<String> = Profile::VARIANTS
        .iter()
        .map(|variant| {
            serde_json::to_value(variant)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();

    let operating_systems: Vec<String> = Platform::VARIANTS
        .iter()
        .map(|variant| {
            serde_json::to_value(variant)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();

    println!("cargo:warning=Found {} browser profiles", profiles.len());
    println!(
        "cargo:warning=Found {} operating systems",
        operating_systems.len()
    );

    // Generate TypeScript type definition
    let ts_type = generate_typescript_types(&profiles, &operating_systems);

    // Generate Rust profiles array
    let rust_profiles = generate_rust_profiles(&profiles, &operating_systems);

    // Write to src directory (going up one level from rust/)
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();

    // Write TypeScript types
    let ts_dest = Path::new(&manifest_dir)
        .parent()
        .unwrap()
        .join("src")
        .join("generated-types.ts");
    fs::write(&ts_dest, ts_type).unwrap();

    // Write Rust profiles array
    let rust_dest = Path::new(&manifest_dir)
        .join("src")
        .join("generated_profiles.rs");
    fs::write(&rust_dest, rust_profiles).unwrap();

    println!("cargo:rerun-if-changed=build.rs");
}

/// Splits `chrome_142` into ("chrome", [142]) and `safari_ios_17.4.1` into
/// ("safari_ios", [17, 4, 1]). Returns None for labels with no numeric suffix.
fn split_profile_label(label: &str) -> Option<(&str, Vec<u32>)> {
    let (family, version) = label.rsplit_once('_')?;
    if family.is_empty() {
        return None;
    }

    let segments = version
        .split('.')
        .map(|segment| segment.parse::<u32>().ok())
        .collect::<Option<Vec<u32>>>()?;

    Some((family, segments))
}

/// Compares segment by segment so that `okhttp_3.11` outranks `okhttp_3.9`,
/// which a lexicographic comparison would get backwards.
fn compare_versions(left: &[u32], right: &[u32]) -> Ordering {
    for index in 0..left.len().max(right.len()) {
        let ordering = left
            .get(index)
            .unwrap_or(&0)
            .cmp(right.get(index).unwrap_or(&0));
        if ordering != Ordering::Equal {
            return ordering;
        }
    }

    Ordering::Equal
}

/// Maps each browser family to its newest profile, e.g. `firefox` -> `firefox_149`.
///
/// Families are matched exactly, so `safari` resolves to the newest desktop Safari
/// and never to `safari_ios_*` or `safari_ipad_*`.
fn derive_aliases(profiles: &[String]) -> Vec<(String, String)> {
    let mut newest: BTreeMap<&str, (Vec<u32>, &str)> = BTreeMap::new();

    for label in profiles {
        let Some((family, segments)) = split_profile_label(label) else {
            continue;
        };

        let is_newer = newest
            .get(family)
            .is_none_or(|(current, _)| compare_versions(&segments, current) == Ordering::Greater);

        if is_newer {
            newest.insert(family, (segments, label.as_str()));
        }
    }

    newest
        .into_iter()
        // An alias must never shadow a concrete profile name.
        .filter(|(family, _)| !profiles.iter().any(|profile| profile == family))
        .map(|(family, (_, label))| (family.to_string(), label.to_string()))
        .collect()
}

fn generate_typescript_types(profiles: &[String], operating_systems: &[String]) -> String {
    let mut ts_content = String::from(
        "/**\n * Auto-generated from Rust build script\n * DO NOT EDIT MANUALLY\n */\n\n",
    );

    ts_content.push_str("/**\n * Browser profile names supported\n */\n");
    ts_content.push_str("export type BrowserProfile =\n");

    for (i, profile) in profiles.iter().enumerate() {
        if i == profiles.len() - 1 {
            // Last profile - put semicolon on same line
            ts_content.push_str(&format!("  | '{}';\n", profile));
        } else {
            ts_content.push_str(&format!("  | '{}'\n", profile));
        }
    }

    ts_content.push_str("\n/**\n * Operating systems supported for emulation\n */\n");
    ts_content.push_str("export type EmulationOS =\n");

    for (i, os) in operating_systems.iter().enumerate() {
        if i == operating_systems.len() - 1 {
            ts_content.push_str(&format!("  | '{}';\n", os));
        } else {
            ts_content.push_str(&format!("  | '{}'\n", os));
        }
    }

    let aliases = derive_aliases(profiles);

    ts_content.push_str(
        "\n/**\n * Browser family aliases, each resolving to the newest profile in its family\n */\n",
    );
    ts_content.push_str("export type BrowserAlias =");

    if aliases.is_empty() {
        ts_content.push_str(" never;\n");
    } else {
        ts_content.push('\n');
        for (i, (alias, _)) in aliases.iter().enumerate() {
            let terminator = if i == aliases.len() - 1 { ";" } else { "" };
            ts_content.push_str(&format!("  | '{}'{}\n", alias, terminator));
        }
    }

    ts_content.push_str(
        "\n/**\n * Newest profile per browser family, resolved when this file was generated.\n * These move as new profiles land upstream, so diff this map when upgrading.\n */\n",
    );
    ts_content.push_str("export const BROWSER_ALIASES: Record<BrowserAlias, BrowserProfile> = {\n");

    for (alias, profile) in &aliases {
        ts_content.push_str(&format!("  {}: '{}',\n", alias, profile));
    }

    ts_content.push_str("};\n");

    ts_content
}

fn generate_rust_profiles(profiles: &[String], operating_systems: &[String]) -> String {
    let mut rust_content =
        String::from("// Auto-generated from build script\n// DO NOT EDIT MANUALLY\n\n");

    rust_content.push_str("pub const BROWSER_PROFILES: &[&str] = &[\n");

    for profile in profiles {
        rust_content.push_str(&format!("    \"{}\",\n", profile));
    }

    rust_content.push_str("];\n");

    rust_content.push_str("\npub const OPERATING_SYSTEMS: &[&str] = &[\n");

    for os in operating_systems {
        rust_content.push_str(&format!("    \"{}\",\n", os));
    }

    rust_content.push_str("];\n");

    rust_content
}
