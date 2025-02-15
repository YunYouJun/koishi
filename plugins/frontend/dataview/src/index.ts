import { Context, Dict, Model, Query, Schema } from 'koishi'
import { DataService } from '@koishijs/plugin-console'
import { resolve } from 'path'
import { deserialize, serialize } from './utils'

export type DbEvents = {
  [M in keyof Query.Methods as `database/${M}`]: (...args: string[]) => Promise<string>
}

declare module '@koishijs/plugin-console' {
  namespace Console {
    interface Services {
      dbInfo: DatabaseProvider
    }
  }

  interface Events extends DbEvents {}
}

export interface TableInfo extends Query.TableStats, Model.Config {}

export interface DatabaseInfo extends Query.Stats {
  tables: Dict<TableInfo>
}

class DatabaseProvider extends DataService<DatabaseInfo> {
  static using = ['console', 'database'] as const

  task: Promise<DatabaseInfo>

  addListener<K extends keyof Query.Methods>(name: K, refresh = false) {
    this.ctx.console.addListener(`database/${name}`, async (...args) => {
      const result = await (this.ctx.database[name] as any)(...args.map(deserialize))
      if (refresh) this.refresh()
      return result === undefined ? result : serialize(result)
    }, { authority: 4 })
  }

  constructor(ctx: Context) {
    super(ctx, 'dbInfo')

    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    })

    this.addListener('create', true)
    this.addListener('drop', true)
    this.addListener('eval', true)
    this.addListener('get')
    this.addListener('remove', true)
    this.addListener('set')
    this.addListener('stats')
    this.addListener('upsert', true)

    ctx.on('model', () => this.refresh())
  }

  async getInfo() {
    const stats = await this.ctx.database.stats()
    const result = { tables: {}, ...stats } as DatabaseInfo
    const tableStats = result.tables
    result.tables = {}
    for (const name in this.ctx.model.config) {
      result.tables[name] = {
        ...this.ctx.model.config[name],
        ...tableStats[name],
      }
    }
    return result
  }

  get(forced = false) {
    if (forced) delete this.task
    return this.task ||= this.getInfo()
  }
}

namespace DatabaseProvider {
  export interface Config {}

  export const Config: Schema<Config> = Schema.object({})
}

export default DatabaseProvider
export * from './utils'
