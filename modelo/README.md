# VideoMAE Crime5 Continuous

Modelo ONNX para detección y clasificación continua de acciones.

El modelo también está publicado en Hugging Face:
[picantitoo/videomae_ucf_crime_finetuned](https://huggingface.co/picantitoo/videomae_ucf_crime_finetuned).

## Clases

0. normal
1. hurto
2. robo
3. agresion_fisica
4. vandalismo

## Instalación

python -m pip install -r requirements.txt

## Ejecución

python infer_onnx.py --video "RUTA_DEL_VIDEO.mp4" --provider cpu

Providers disponibles: auto, cpu y cuda.

## Entrada y salida

Entrada: tensor float32 [1, 3, 16, 224, 224], disposición NCTHW.
Salida: cinco logits en el orden indicado anteriormente.

El script realiza el muestreo, preprocesamiento, softmax y control temporal de alertas.

## Política temporal

- Suavizado: 4 ventanas
- Umbral: 0.40
- Confirmación: 2 ventanas
- Liberación: 3 ventanas

IMPORTANTE: videomae_crime5_continuous.onnx y
videomae_crime5_continuous.onnx.data deben permanecer juntos.


## Obtener los pesos

Los pesos no están incluidos en Git. Solicitar al responsable del modelo los
archivos `videomae_crime5_continuous.onnx` y
`videomae_crime5_continuous.onnx.data`, y colocarlos juntos en esta carpeta.
Consultar el repositorio de Hugging Face para los archivos publicados.
El backend requiere los dos archivos ONNX indicados arriba; deben corresponder
a la versión compatible con estos metadatos.
Solicitar también al responsable del modelo los hashes SHA-256 esperados. No
modificar los metadatos para acomodar otra versión del modelo sin validar su
compatibilidad.

Para calcular los hashes en PowerShell, desde la raíz del repositorio:

```powershell
Get-FileHash modelo/videomae_crime5_continuous.onnx -Algorithm SHA256
Get-FileHash modelo/videomae_crime5_continuous.onnx.data -Algorithm SHA256
```

El backend utiliza su propia política de eventos confirmados para EN-4;
la política descrita arriba corresponde al script independiente de inferencia.
Instalación y ejecución del servicio: [backend/README.md](../backend/README.md).

## VadCLIP (`vadclip/`)

Detector del híbrido VadCLIP + VideoMAE: `clip_visual.onnx` (CLIP ViT-B/16, 512 valores por imagen) y
`vadclip_head.onnx` (puntaje de anomalía con los últimos 8 vectores). Los `.onnx` no van en git: copiarlos
del paquete de Piero `sentrix_vadclip_videomae_onnx_v1/models/` (SHA-256 en `vadclip/metadata.json`).
`metadata.json` fija las entradas, la normalización de CLIP y la política del runner.
