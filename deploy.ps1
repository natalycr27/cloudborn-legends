<#
.SYNOPSIS
    Script de despliegue de extremo a extremo de Cloudborn Legends (Windows / PowerShell).

.DESCRIPTION
    Despliegue de un solo paso (Requisito 17.1): tras configurar las credenciales de
    AWS no se requiere ninguna accion manual adicional. El script:
      1. Construye y despliega la aplicacion SAM (backend + infraestructura).
      2. Lee los outputs de CloudFormation (ApiUrl, bucket S3, id de CloudFront).
      3. Genera frontend/config.js con la URL real de la API.
      4. Sube los archivos estaticos del frontend al bucket S3.
      5. Invalida la cache de CloudFront para publicar los cambios de inmediato.

.NOTES
    Requiere: AWS SAM CLI y AWS CLI configuradas con credenciales validas.
    Uso:      pwsh ./deploy.ps1
#>

# Detener la ejecucion ante el primer error no controlado.
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Configuracion del despliegue
# ---------------------------------------------------------------------------
# Nombre del stack de CloudFormation y region fijos para este proyecto.
$StackName = 'cloudborn-legends'
$Region    = 'us-east-1'

# Rutas de trabajo resueltas respecto a la ubicacion de este script,
# de modo que el despliegue funcione sin importar el directorio actual.
$RepoRoot    = $PSScriptRoot
$FrontendDir = Join-Path $RepoRoot 'frontend'
$ConfigFile  = Join-Path $FrontendDir 'config.js'

Write-Host '=== Cloudborn Legends :: despliegue ===' -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. Construccion y despliegue del backend con AWS SAM
# ---------------------------------------------------------------------------
# sam build empaqueta las Lambdas (incluida la carpeta compartida backend/shared/).
Write-Host '[1/5] Construyendo la aplicacion SAM (sam build)...' -ForegroundColor Yellow
sam build
if ($LASTEXITCODE -ne 0) { throw 'sam build fallo.' }

# sam deploy aplica el template. --no-confirm-changeset y los defaults hacen el
# despliegue no interactivo; --resolve-s3 gestiona el bucket de artefactos de SAM.
Write-Host '[2/5] Desplegando el stack en AWS (sam deploy)...' -ForegroundColor Yellow
sam deploy `
    --stack-name $StackName `
    --region $Region `
    --capabilities CAPABILITY_IAM `
    --resolve-s3 `
    --no-confirm-changeset `
    --no-fail-on-empty-changeset
if ($LASTEXITCODE -ne 0) { throw 'sam deploy fallo.' }

# ---------------------------------------------------------------------------
# 2. Lectura de los outputs de CloudFormation
# ---------------------------------------------------------------------------
# Se obtienen los tres valores que el frontend y la publicacion necesitan:
# la URL de la API, el nombre del bucket S3 y el id de la distribucion CloudFront.
Write-Host '[3/5] Leyendo los outputs del stack...' -ForegroundColor Yellow

# Funcion auxiliar: devuelve el valor de un output por su OutputKey.
function Get-StackOutput([string]$Key) {
    $value = aws cloudformation describe-stacks `
        --stack-name $StackName `
        --region $Region `
        --query "Stacks[0].Outputs[?OutputKey=='$Key'].OutputValue" `
        --output text
    if ($LASTEXITCODE -ne 0) { throw "No se pudo leer el output '$Key'." }
    return $value.Trim()
}

$ApiUrl           = Get-StackOutput 'ApiUrl'
$FrontendBucket   = Get-StackOutput 'FrontendBucketName'
$DistributionId   = Get-StackOutput 'CloudFrontDistributionId'

# Validar que los outputs existen antes de continuar.
if ([string]::IsNullOrWhiteSpace($ApiUrl))         { throw 'El output ApiUrl esta vacio.' }
if ([string]::IsNullOrWhiteSpace($FrontendBucket)) { throw 'El output FrontendBucketName esta vacio.' }
if ([string]::IsNullOrWhiteSpace($DistributionId)) { throw 'El output CloudFrontDistributionId esta vacio.' }

Write-Host "      ApiUrl             = $ApiUrl"
Write-Host "      FrontendBucket     = $FrontendBucket"
Write-Host "      DistributionId     = $DistributionId"

# ---------------------------------------------------------------------------
# 3. Generacion de frontend/config.js con la URL real de la API
# ---------------------------------------------------------------------------
# Este archivo conecta el frontend estatico con la API desplegada sin hardcodear
# URLs en el codigo. Esta en .gitignore y se regenera en cada despliegue.
Write-Host '[4/5] Generando frontend/config.js...' -ForegroundColor Yellow
$ConfigContent = "window.CONFIG = { apiUrl: `"$ApiUrl`" };`n"
Set-Content -Path $ConfigFile -Value $ConfigContent -Encoding UTF8 -NoNewline

# ---------------------------------------------------------------------------
# 4. Subida de los archivos estaticos del frontend al bucket S3
# ---------------------------------------------------------------------------
# Solo deben publicarse index.html, config.js y las carpetas src/, scenes/ y assets/.
# Se excluyen dependencias y archivos de desarrollo/pruebas que no pertenecen al sitio.
Write-Host '[5/5] Sincronizando el frontend con S3 e invalidando CloudFront...' -ForegroundColor Yellow
aws s3 sync $FrontendDir "s3://$FrontendBucket" `
    --region $Region `
    --delete `
    --exclude 'node_modules/*' `
    --exclude '*.test.js' `
    --exclude 'package.json' `
    --exclude 'package-lock.json' `
    --exclude 'vitest.config.js'
if ($LASTEXITCODE -ne 0) { throw 'aws s3 sync fallo.' }

# ---------------------------------------------------------------------------
# 5. Invalidacion de la cache de CloudFront
# ---------------------------------------------------------------------------
# Invalida todas las rutas para que los usuarios reciban la version recien subida
# sin esperar a que expire la cache del CDN.
aws cloudfront create-invalidation `
    --distribution-id $DistributionId `
    --paths '/*' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'aws cloudfront create-invalidation fallo.' }

# ---------------------------------------------------------------------------
# Fin: mostrar la URL publica del juego
# ---------------------------------------------------------------------------
$CloudFrontUrl = Get-StackOutput 'CloudFrontUrl'
Write-Host ''
Write-Host '=== Despliegue completado ===' -ForegroundColor Green
Write-Host "Juega en: $CloudFrontUrl" -ForegroundColor Green
