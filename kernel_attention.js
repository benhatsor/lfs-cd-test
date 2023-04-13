const createFFNShader = () => `
  struct Matrix {
    data: array<f32>, // runtime-sized array
  }

  struct Dimensions {
    dimY: u32, // row dimension of A and row dimension of C
    dimX: u32, // col dimension of B and col dimension of C
    dimS: u32, // shared dimension of A and B
  };

  @group(1) @binding(0) var<storage, read> Input: Matrix;

  @group(0) @binding(0) var<uniform> DimBuffer: Dimensions;
  @group(0) @binding(1) var<storage, read> Bias: Matrix;
  @group(0) @binding(2) var<storage, read> Weight: Matrix;
  @group(0) @binding(3) var<storage, read_write> Result: Matrix;

  @compute @workgroup_size(16, 16)
  fn main (@builtin(global_invocation_id) global_id: vec3<u32>) {
    let row: u32 = global_id.x;
    let col: u32 = global_id.y;
    let dimX: u32 = DimBuffer.dimX;
    let dimY: u32 = DimBuffer.dimY;
    let dimS: u32 = DimBuffer.dimS;

    if (row >= dimY || col >= dimX) {
      return;
    }

    var sum: f32 = 0.0;
    for (var i: u32 = 0; i < dimS; i = i + 1) {
        sum = sum + Input.data[row * dimS + i] * Weight.data[i * dimX + col];
    }

    Result.data[row * dimX + col] = sum + Bias.data[col];
  }
  `;

const createSplitQKVShader = () => `
  struct Matrix {
    data: array<f32>, // runtime-sized array
  }

  struct Dimensions {
    dimY: u32, // row dimension of Q, K, V
    dimX: u32, // col dimension of Q, K, V
    inputDimX: u32, // col dimension of Input
  };

  @group(1) @binding(0) var<storage, read> Input: Matrix;

  @group(0) @binding(0) var<uniform> DimBuffer: Dimensions;
  @group(0) @binding(1) var<storage, read_write> Q: Matrix;
  @group(0) @binding(2) var<storage, read_write> K: Matrix;
  @group(0) @binding(3) var<storage, read_write> V: Matrix;


  @compute @workgroup_size(16, 16)
  fn main (@builtin(global_invocation_id) global_id: vec3<u32>) {
    let row: u32 = global_id.x;
    let col: u32 = global_id.y;
    let dimX: u32 = DimBuffer.dimX;
    let dimY: u32 = DimBuffer.dimY;
    let inputDimX: u32 = DimBuffer.inputDimX;
    

    if (row >= dimY || col >= dimX) {
      return;
    }

    Q.data[row * dimX + col] = Input.data[row * inputDimX + col];
    K.data[row * dimX + col] = Input.data[row * inputDimX + dimX + col];
    V.data[row * dimX + col] = Input.data[row * inputDimX + 2 * dimX + col];

  }
  `;

// I think I can unify these but leaving for now, as per before I don't really care about optimizing this code right now.
//   queue.writeBuffer(splitHeadUniformBuffer, 0, new Uint32Array([rows, Math.ceil(cols / n_heads), n_heads, cols]));
const createSplitHeadsShader = () => `
  struct Matrix {
    data: array<f32>, // runtime-sized array
  }

  struct Dimensions {
    dimY: u32, // row dimension of Q, K, V
    dimX: u32, // col dimension of Q, K, V
    nHeads: u32, // number of heads or depth dimension of Q, K, V
    dimInputX: u32, // col dimension of Input
  };

  @group(1) @binding(0) var<storage, read> Q_input: Matrix;
  @group(1) @binding(1) var<storage, read> K_input: Matrix;
  @group(1) @binding(2) var<storage, read> V_input: Matrix;

  @group(0) @binding(0) var<uniform> DimBuffer: Dimensions;
  @group(0) @binding(1) var<storage, read_write> Q: Matrix;
  @group(0) @binding(2) var<storage, read_write> K: Matrix;
  @group(0) @binding(3) var<storage, read_write> V: Matrix;


  @compute @workgroup_size(4, 4, 4)
  fn main (@builtin(global_invocation_id) global_id: vec3<u32>) {
    let row: u32 = global_id.x;
    let col: u32 = global_id.y;
    let depth: u32 = global_id.z;
    let dimX: u32 = DimBuffer.dimX;
    let dimY: u32 = DimBuffer.dimY;
    let nHeads: u32 = DimBuffer.nHeads;
    let dimInputX: u32 = DimBuffer.dimInputX;
    
    if (row >= dimY || col >= dimX || depth >= nHeads) {
      return;
    }

    Q.data[depth * dimX * dimY + row * dimX + col] = Q_input.data[depth * nHeads + row * dimInputX + col];
    K.data[depth * dimX * dimY + row * dimX + col] = K_input.data[depth * nHeads + row * dimInputX + col];
    V.data[depth * dimX * dimY + row * dimX + col] = V_input.data[depth * nHeads + row * dimInputX + col];
  }
  `;

const output = [
  [792, 858, 924],
  [4248, 4602, 4956],
  [5976, 6474, 6972],
  [7704, 8346, 8988],
  [9432, 10218, 11004],
  [11160, 12090, 13020],
  [12888, 13962, 15036],
  [14616, 15834, 17052],
  [16344, 17706, 19068],
  [18072, 19578, 21084],
  [19800, 21450, 23100],
];

const createAttentionWeightsShader = () => `
  struct Matrix {
    data: array<f32>, // runtime-sized array
  }

  struct Dimensions {
    dimXY: u32, // output row and col dimension, Q & K row dimension (context)
    qkvCols: u32, // col dim of Q, K   
  };

  @group(1) @binding(0) var<storage, read> Queries: Matrix;
  @group(1) @binding(1) var<storage, read> Keys: Matrix;

  @group(0) @binding(0) var<uniform> DimBuffer: Dimensions;
  @group(0) @binding(1) var<storage, read_write> Result: Matrix;

  @compute @workgroup_size(16, 16)
  fn main (@builtin(global_invocation_id) global_id: vec3<u32>) {
    let row: u32 = global_id.x;
    let col: u32 = global_id.y;
    let dimXY: u32 = DimBuffer.dimXY;
    let qkvCols: u32 = DimBuffer.qkvCols;

    if (row >= dimXY || col >= dimXY) {
      return;
    }

    var head: u32 = col / qkvCols;
    var sum: f32 = 0.0;
    for (var i: u32 = 0; i < dimXY; i = i + 1) {
        sum = sum + Queries.data[row * dimXY + i + head * qkvCols] * Keys.data[col * dimXY + i + head * qkvCols];
    }

    // this changes to be T (context) * n_heads
    Result.data[row * dimXY + col] = f32(col);
  }
  `;

async function attention(rows, cols, input, n_heads, qkv_weights, qkv_bias) {
  const { device, queue } = await initializeWebGPU();
  const minStorageBufferOffsetAlignment = device.limits.minStorageBufferOffsetAlignment;
  const bufferSizeCalc = (dimA, dimB = 1) => alignedSize(dimA * dimB * Float32Array.BYTES_PER_ELEMENT, minStorageBufferOffsetAlignment);
  const workgroup_X = 16; // Dictated by shader.
  const workgroup_Y = 16; // Dictated by shader.
  const workgroup_XYZ = 8; // Dictated by shader.
  const qkv_col_dim = 3 * cols;
  const head_dim = Math.ceil(cols / n_heads);

  // Generic bind group for input buffer, can be reused.
  const inputBufferBindGroupLayout = createBindGroupLayout(device, ["read-only-storage"]);

  // FFN pipeline, can be reused.
  const ffnBindGroupLayout = createBindGroupLayout(device, ["uniform", "read-only-storage", "read-only-storage", "storage"]);
  const FFNpipeline = createPipeline(device, createFFNShader(), [ffnBindGroupLayout, inputBufferBindGroupLayout]);

  // Split QKV pipeline, can be reused.
  const splitQKVBindGroupLayout = createBindGroupLayout(device, ["uniform", "storage", "storage", "storage"]);
  const splitQKVpipeline = createPipeline(device, createSplitQKVShader(), [splitQKVBindGroupLayout, inputBufferBindGroupLayout]);

  // Bind group for QKV input buffer, can be reused.
  const QKVInputBufferBindGroupLayout = createBindGroupLayout(device, ["read-only-storage", "read-only-storage", "read-only-storage"]);

  // Split QKV pipeline, can be reused.
  const attentionWeightsInputBindGroupLayout = createBindGroupLayout(device, ["read-only-storage", "read-only-storage"]);
  const attentionWeightsBindGroupLayout = createBindGroupLayout(device, ["uniform", "storage"]);
  const attentionWeightsPipeline = createPipeline(device, createAttentionWeightsShader(), [
    attentionWeightsBindGroupLayout,
    attentionWeightsInputBindGroupLayout,
  ]);

  // Split heads pipeline, can be reused.
  // const splitHeadpipeline = createPipeline(device, createSplitHeadsShader(), [splitQKVBindGroupLayout, QKVInputBufferBindGroupLayout]);

  console.log("Starting network");
  const inputBuffer = createBuffer(device, bufferSizeCalc(rows, cols), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  queue.writeBuffer(inputBuffer, 0, input);

  const qkvUniformBuffer = createBuffer(device, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const qkvWeightsBuffer = createBuffer(device, bufferSizeCalc(rows, qkv_col_dim), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  const qkvBiasBuffer = createBuffer(device, bufferSizeCalc(qkv_col_dim), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  const qkvResultBuffer = createBuffer(device, bufferSizeCalc(rows, qkv_col_dim), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  const qkvBindGroup = createBindGroup(device, ffnBindGroupLayout, [qkvUniformBuffer, qkvBiasBuffer, qkvWeightsBuffer, qkvResultBuffer]);
  queue.writeBuffer(qkvUniformBuffer, 0, new Uint32Array([rows, qkv_col_dim, cols]));
  queue.writeBuffer(qkvWeightsBuffer, 0, qkv_weights);
  queue.writeBuffer(qkvBiasBuffer, 0, qkv_bias);

  const splitQKVUniformBuffer = createBuffer(device, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const splitQResultBuffer = createBuffer(device, bufferSizeCalc(rows, cols), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  const splitKResultBuffer = createBuffer(device, bufferSizeCalc(rows, cols), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  const splitVResultBuffer = createBuffer(device, bufferSizeCalc(rows, cols), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  const splitQKVBindGroup = createBindGroup(device, splitQKVBindGroupLayout, [
    splitQKVUniformBuffer,
    splitQResultBuffer,
    splitKResultBuffer,
    splitVResultBuffer,
  ]);
  queue.writeBuffer(splitQKVUniformBuffer, 0, new Uint32Array([rows, cols, qkv_col_dim]));

  // const splitHeadUniformBuffer = createBuffer(device, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  // const splitQHeadResultBuffer = createBuffer(device, bufferSizeCalc(rows, cols), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  // const splitKHeadResultBuffer = createBuffer(device, bufferSizeCalc(rows, cols), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  // const splitVHeadResultBuffer = createBuffer(device, bufferSizeCalc(rows, cols), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  // const splitHeadBindGroup = createBindGroup(device, splitQKVBindGroupLayout, [
  //   splitHeadUniformBuffer,
  //   splitQHeadResultBuffer,
  //   splitKHeadResultBuffer,
  //   splitVHeadResultBuffer,
  // ]);
  // queue.writeBuffer(splitHeadUniformBuffer, 0, new Uint32Array([rows, Math.ceil(cols / n_heads), n_heads, cols]));

  const attentionWeightsUniformBuffer = createBuffer(device, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const attentionWeightsResultBuffer = createBuffer(device, bufferSizeCalc(rows, rows * n_heads), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  const attentionWeightsBindGroup = createBindGroup(device, attentionWeightsBindGroupLayout, [attentionWeightsUniformBuffer, attentionWeightsResultBuffer]);
  queue.writeBuffer(attentionWeightsUniformBuffer, 0, new Uint32Array([rows, head_dim]));

  console.log("Starting passes");
  const commandEncoder = device.createCommandEncoder();

  const passEncoder_qkv = commandEncoder.beginComputePass();
  passEncoder_qkv.setPipeline(FFNpipeline);
  passEncoder_qkv.setBindGroup(0, qkvBindGroup);
  passEncoder_qkv.setBindGroup(1, createBindGroup(device, inputBufferBindGroupLayout, [inputBuffer]));
  passEncoder_qkv.dispatchWorkgroups(workgroupCalc(rows, workgroup_Y), workgroupCalc(qkv_col_dim, workgroup_X));
  passEncoder_qkv.end();

  const passEncoder_splitQKV = commandEncoder.beginComputePass();
  passEncoder_splitQKV.setPipeline(splitQKVpipeline);
  passEncoder_splitQKV.setBindGroup(0, splitQKVBindGroup);
  passEncoder_splitQKV.setBindGroup(1, createBindGroup(device, inputBufferBindGroupLayout, [qkvResultBuffer]));
  passEncoder_splitQKV.dispatchWorkgroups(workgroupCalc(rows, workgroup_Y), workgroupCalc(cols, workgroup_X));
  passEncoder_splitQKV.end();

  // const passEncoder_splitHead = commandEncoder.beginComputePass();
  // passEncoder_splitHead.setPipeline(splitHeadpipeline);
  // passEncoder_splitHead.setBindGroup(0, splitHeadBindGroup);
  // passEncoder_splitHead.setBindGroup(1, createBindGroup(device, QKVInputBufferBindGroupLayout, [splitQResultBuffer, splitKResultBuffer, splitVResultBuffer]));
  // passEncoder_splitHead.dispatchWorkgroups(
  //   workgroupCalc(rows * 2, workgroup_XYZ),
  //   workgroupCalc(Math.ceil((cols * 2) / n_heads), workgroup_XYZ),
  //   workgroupCalc(n_heads, workgroup_XYZ)
  // );
  // passEncoder_splitHead.end();

  const passEncoder_attentionWeights = commandEncoder.beginComputePass();
  passEncoder_attentionWeights.setPipeline(attentionWeightsPipeline);
  passEncoder_attentionWeights.setBindGroup(0, attentionWeightsBindGroup);
  passEncoder_attentionWeights.setBindGroup(1, createBindGroup(device, attentionWeightsInputBindGroupLayout, [splitQResultBuffer, splitKResultBuffer]));
  passEncoder_attentionWeights.dispatchWorkgroups(workgroupCalc(rows, workgroup_Y), workgroupCalc(rows * n_heads, workgroup_X));
  passEncoder_attentionWeights.end();

  const output_rows = rows;
  const output_cols = rows * n_heads;
  const outputBufferSize = bufferSizeCalc(output_rows, output_cols);
  const readBuffer = createBuffer(device, outputBufferSize, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
  const copyCommandEncoder = device.createCommandEncoder();
  copyCommandEncoder.copyBufferToBuffer(attentionWeightsResultBuffer, 0, readBuffer, 0, outputBufferSize);

  queue.submit([commandEncoder.finish(), copyCommandEncoder.finish()]);

  await readBuffer.mapAsync(GPUMapMode.READ);
  console.log("Done!");
  const result = readBuffer.getMappedRange();
  printMatrix(output_rows, output_cols, new Float32Array(result));
  return result;
}

(async () => {
  const row = 12;
  const col = 12;
  const input = new Float32Array(row * col);
  for (let i = 0; i < row * col; i++) input[i] = i;
  const n_heads = 4;

  const qkv_weights = new Float32Array(col * 3 * col);
  for (let y = 0; y < col; y++) {
    for (let x = 0; x < col * 3; x++) {
      qkv_weights[y * col * 3 + x] = x;
    }
  }
  const qkv_bias = new Float32Array(col * 3).fill(0);

  printMatrix(row, col, input);
  printMatrix(col, col * 3, qkv_weights);

  const result = await attention(row, col, input, n_heads, qkv_weights, qkv_bias);

  // for (let i = 0; i < n_heads; i++) {
  //   const sliced = result.slice(i * row * col * 3, (i + 1) * row * col * 3);
  //   const mat = printMatrix(row, col / n_heads, new Float32Array(sliced));
  // }
  // for (const row of mat) {
  //   console.log(row.reduce((a, b) => a + b));
  // console.log(getStandardDeviation(row));
  // }
})();

function printMatrix(rows, cols, array) {
  // console.log(array);
  const matrix = [];
  for (let i = 0; i < rows; i++) {
    matrix.push(Array.from(array.slice(i * cols, (i + 1) * cols)));
  }
  console.log(matrix);
  return matrix;
}

function getStandardDeviation(array) {
  const n = array.length;
  const mean = array.reduce((a, b) => a + b) / n;
  return Math.sqrt(array.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
}