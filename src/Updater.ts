import { encrypt } from '@corelink/crc16';
import { IStatus } from './IStatus';

const FILE_INFO_BUFFER_SIZE = 32;
const ERR_TIMEOUT_MESSAGE = 'timeout';
const ERR_CRC16_MESSAGE = 'invalid signature';
const ERR_CMD_MESSAGE = 'cmd error';
const ERR_STOPPED_MESSAGE = 'stopped';

export abstract class Updater {
  public sender: any;
  public receiver: any;
  public updateFile!: ArrayBuffer;
  public updateFileBufferSize: number = 224;
  public pNum!: number;

  protected statuses: IStatus[] = [];

  private onProgressCbs: Array<(progress: number) => any> = [];
  private onCompleteCbs: Array<() => any> = [];
  private onStartCbs: Array<() => any> = [];
  private stopped!: boolean;

  constructor(
    private cmd: number,
    private cmdIndex: number,
    private dataOffset: number = FILE_INFO_BUFFER_SIZE,
    private timeout: number = 3000
  ) {}

  get totalPackages() {
    return Math.ceil(
      (this.updateFile.byteLength - this.dataOffset) /
        this.updateFileBufferSize +
        1
    );
  }

  public onProgress(fn: (progress: number) => any) {
    this.onProgressCbs.push(fn);
  }

  public onComplete(fn: () => any) {
    this.onCompleteCbs.push(fn);
  }

  public onStart(fn: () => any) {
    this.onStartCbs.push(fn);
  }

  public stop() {
    this.stopped = true;
  }

  /**
   * 数据包0号
   */
  public async preSendPackage(): Promise<void> {
    this.pNum = 0;
    const buffer = this.generateBuffer(
      0,
      this.updateFile.slice(0, this.dataOffset)
    );
    await this.exec(buffer);
    for (const cb of this.onStartCbs) {
      cb();
    }
    this.stopped = false;
  }

  /**
   * 拆分发送数据包
   * @param pNum 包号
   */
  public async processPackage(pNum: number = 1): Promise<void> {
    console.log('processing >>>>>', pNum);
    this.pNum = pNum;
    if (this.stopped) throw new Error(ERR_STOPPED_MESSAGE);
    const offset = this.dataOffset + (pNum - 1) * this.updateFileBufferSize;
    let ab = this.updateFile.slice(offset, offset + this.updateFileBufferSize);
    if (!ab.byteLength) return this.afterSendPackage();
    if (ab.byteLength < this.updateFileBufferSize) {
      const _ab = new ArrayBuffer(this.updateFileBufferSize);
      const u8a = new Uint8Array(ab);
      const _u8a = new Uint8Array(_ab);
      for (let i = 0; i < _u8a.length; i++) {
        if (i < u8a.length) {
          _u8a[i] = u8a[i];
        } else {
          _u8a[i] = 0xff;
        }
      }
      ab = _ab;
    }
    const data = this.generateBuffer(pNum, ab);
    await this.exec(data);
    const process =
      ((pNum - 1) * this.updateFileBufferSize + ab.byteLength) /
      (this.updateFile.byteLength - 6);
    for (const cb of this.onProgressCbs) {
      cb(process);
    }
    return this.processPackage(pNum + 1);
  }

  protected abstract pack(ab: ArrayBuffer): ArrayBuffer;
  protected abstract checkSign(ab: ArrayBuffer): boolean;
  /**
   * 将文件流包装成数据
   * @param pNum 包序号
   * @param ab 数据包
   */
  protected generateBuffer(pNum: number, ab: ArrayBuffer): ArrayBuffer {
    const u8a = new Uint8Array(ab);
    const data = new ArrayBuffer(ab.byteLength + 6);
    const dv = new DataView(data);
    for (let i = 0; i < u8a.length; i++) {
      dv.setUint8(i + 4, u8a[i]);
    }
    dv.setUint16(0, this.totalPackages, true);
    dv.setUint16(2, pNum, true);
    const crc = encrypt(u8a);
    dv.setUint16(data.byteLength - 2, crc, true);
    return data;
  }

  /**
   * 数据包发送完毕
   */
  protected async afterSendPackage(): Promise<void> {
    for (const cb of this.onCompleteCbs) {
      cb();
    }
  }

  /**
   * 执行发送数据
   * @param ab 数据
   */
  private exec(ab: ArrayBuffer): Promise<any> {
    const timeout = new Promise<any>((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(ERR_TIMEOUT_MESSAGE));
      }, this.timeout);
    });

    const trying = async (t = 0): Promise<any> => {
      try {
        const res = await Promise.race([this.sendCommand(ab), timeout]);
        return res;
      } catch (e) {
        console.error(e);
        if (ERR_TIMEOUT_MESSAGE === e.message && t <= 3) {
          console.log('重试:', t, e);
          return trying(t + 1);
        } else {
          console.error('发生错误:', e);
          throw e;
        }
      }
    };
    return trying();
  }

  /**
   * 发送数据
   * @param ab 数据
   */
  private sendCommand(ab: ArrayBuffer) {
    console.log('send command >>>>');
    return new Promise<any>((resolve, reject) => {
      const sub = this.receiver.subscribe(async (res: any) => {
        try {
          await this.check(res.data);
          resolve(res);
        } catch (e) {
          reject(e);
        }
        sub.unsubscribe();
      });
      const data = this.pack(ab);
      this.sender.send(data);
    });
  }

  /**
   * 检查返回数据
   * @param ab 数据
   */
  private check(ab: ArrayBuffer) {
    if (!this.checkSign(ab)) {
      throw new Error(ERR_CRC16_MESSAGE);
    }
    const u8a = new Uint8Array(ab);
    console.log('u8a from mcu', u8a);
    for (const status of this.statuses.filter(x => !x.success)) {
      if (u8a[this.cmdIndex + 1] === status.code) {
        throw new Error(status.message);
      }
    }

    if (u8a[this.cmdIndex] !== this.cmd) {
      throw new Error(
        ERR_CMD_MESSAGE + ', ' + u8a[this.cmdIndex] + ', ' + this.cmd
      );
    }
  }
}
