# draw.io XML templates

Read this when generating the XML: it holds the single-account and multi-account starting templates, AWS service icon styles, and common patterns to copy from.

## Design Inspector Compatible XML Templates

These templates are optimized for Design Inspector's security analysis and threat modeling features:

### Single Account Architecture Template

```xml
<mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>

    <!-- Title -->
    <mxCell id="title" value="{SYSTEM_NAME} - {ENVIRONMENT} Architecture"
           style="text;fontSize=20;fontStyle=1;align=center;fillColor=none;"
           vertex="1" parent="1">
      <mxGeometry x="400" y="20" width="400" height="30" as="geometry"/>
    </mxCell>

    <!-- AWS Account -->
    <mxCell id="account" value="AWS Account: {ACCOUNT_NAME} ({ACCOUNT_ID})"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;dashed=1;fontSize=14;fontStyle=1;"
           vertex="1" parent="1">
      <mxGeometry x="50" y="80" width="1100" height="700" as="geometry"/>
    </mxCell>

    <!-- Region -->
    <mxCell id="region" value="Region: {REGION_NAME}"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;dashed=1;fontSize=12;fontStyle=1;"
           vertex="1" parent="1">
      <mxGeometry x="80" y="120" width="1040" height="620" as="geometry"/>
    </mxCell>

    <!-- VPC -->
    <mxCell id="vpc" value="VPC: {VPC_NAME}"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;dashed=1;fontSize=12;"
           vertex="1" parent="1">
      <mxGeometry x="110" y="160" width="980" height="540" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>
```

### Multi-Account Architecture Template

```xml
<mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1400" pageHeight="900">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>

    <!-- Title -->
    <mxCell id="title" value="{SYSTEM_NAME} - Multi-Account Architecture"
           style="text;fontSize=20;fontStyle=1;align=center;"
           vertex="1" parent="1">
      <mxGeometry x="500" y="20" width="400" height="30" as="geometry"/>
    </mxCell>

    <!-- Production Account -->
    <mxCell id="prod_account" value="Production Account ({PROD_ACCOUNT_ID})"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;dashed=1;fontSize=14;fontStyle=1;"
           vertex="1" parent="1">
      <mxGeometry x="50" y="80" width="600" height="380" as="geometry"/>
    </mxCell>

    <!-- Development Account -->
    <mxCell id="dev_account" value="Development Account ({DEV_ACCOUNT_ID})"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;dashed=1;fontSize=14;fontStyle=1;"
           vertex="1" parent="1">
      <mxGeometry x="700" y="80" width="600" height="380" as="geometry"/>
    </mxCell>

    <!-- Shared Services Account -->
    <mxCell id="shared_account" value="Shared Services Account ({SHARED_ACCOUNT_ID})"
           style="rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;dashed=1;fontSize=14;fontStyle=1;"
           vertex="1" parent="1">
      <mxGeometry x="375" y="500" width="550" height="300" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>
```

### AWS Service Icon Examples

```xml
<!-- API Gateway -->
<mxCell id="api_gateway" value="REST API"
       style="sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;gradientColor=#FF4F8B;gradientDirection=north;fillColor=#BC1356;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.api_gateway;"
       vertex="1" parent="1">
  <mxGeometry x="300" y="300" width="78" height="78" as="geometry"/>
</mxCell>

<!-- Lambda Function -->
<mxCell id="lambda" value="Task Service"
       style="sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;gradientColor=#F78E04;gradientDirection=north;fillColor=#D05C17;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;"
       vertex="1" parent="1">
  <mxGeometry x="500" y="300" width="78" height="78" as="geometry"/>
</mxCell>

<!-- DynamoDB -->
<mxCell id="dynamodb" value="Tasks DB"
       style="sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;gradientColor=#4D72F3;gradientDirection=north;fillColor=#3334B9;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.dynamodb;"
       vertex="1" parent="1">
  <mxGeometry x="700" y="300" width="78" height="78" as="geometry"/>
</mxCell>

<!-- Connection Arrow -->
<mxCell id="connection1" value="HTTPS"
       style="endArrow=classic;html=1;rounded=0;strokeColor=#0066CC;strokeWidth=2;"
       edge="1" parent="1" source="api_gateway" target="lambda">
  <mxGeometry width="50" height="50" relative="1" as="geometry">
    <mxPoint x="400" y="400" as="sourcePoint"/>
    <mxPoint x="450" y="350" as="targetPoint"/>
  </mxGeometry>
</mxCell>
```

## Common XML Patterns

### 1. Serverless Web Application XML

```xml
<!-- User -->
<mxCell id="user" value="User"
       style="sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=#232F3D;strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;pointerEvents=1;shape=mxgraph.aws4.user;"
       vertex="1" parent="1">
  <mxGeometry x="100" y="200" width="78" height="78" as="geometry"/>
</mxCell>

<!-- CloudFront -->
<mxCell id="cloudfront" value="CDN"
       style="sketch=0;points=[[0,0,0],[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0,0],[0,1,0],[0.25,1,0],[0.5,1,0],[0.75,1,0],[1,1,0],[0,0.25,0],[0,0.5,0],[0,0.75,0],[1,0.25,0],[1,0.5,0],[1,0.75,0]];outlineConnect=0;fontColor=#232F3E;gradientColor=#945DF2;gradientDirection=north;fillColor=#5A30B5;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.cloudfront;"
       vertex="1" parent="1">
  <mxGeometry x="300" y="200" width="78" height="78" as="geometry"/>
</mxCell>

<!-- Connection -->
<mxCell id="user_to_cloudfront" value="HTTPS"
       style="endArrow=classic;html=1;rounded=0;strokeColor=#0066CC;strokeWidth=2;"
       edge="1" parent="1" source="user" target="cloudfront">
  <mxGeometry width="50" height="50" relative="1" as="geometry">
    <mxPoint x="200" y="300" as="sourcePoint"/>
    <mxPoint x="250" y="250" as="targetPoint"/>
  </mxGeometry>
</mxCell>
```

### 2. Logical Grouping Pattern

```xml
<!-- API Gateway Cluster with intermittent lines -->
<mxCell id="api_cluster" value="API Layer"
       style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;dashed=1;fontSize=12;fontStyle=1;"
       vertex="1" parent="1">
  <mxGeometry x="200" y="150" width="300" height="200" as="geometry"/>
</mxCell>

<!-- Services within cluster -->
<mxCell id="api_gateway" value="API Gateway" parent="api_cluster" vertex="1">
  <mxGeometry x="50" y="50" width="78" height="78" as="geometry"/>
</mxCell>

<mxCell id="lambda_service" value="Lambda" parent="api_cluster" vertex="1">
  <mxGeometry x="172" y="50" width="78" height="78" as="geometry"/>
</mxCell>

<!-- Return traffic with dashed arrow -->
<mxCell id="return_traffic" value="Response"
       style="endArrow=classic;html=1;rounded=0;strokeColor=#0066CC;strokeWidth=2;dashed=1;"
       edge="1" parent="1" source="lambda_service" target="api_gateway">
  <mxGeometry width="50" height="50" relative="1" as="geometry">
    <mxPoint x="300" y="250" as="sourcePoint"/>
    <mxPoint x="250" y="200" as="targetPoint"/>
  </mxGeometry>
</mxCell>
```
